// Restablece la contraseña de un admin desde la consola del servidor (sin email): quien puede
// ejecutar esto ya tiene acceso al host, que es la prueba de confianza.
//   docker compose exec app node src/resetAdmin.js <DNI>
import mongoose from "mongoose";
import { createInterface } from "node:readline";
import { User, Session, ActivityLog } from "./models.js";
import { hashPassword } from "./auth.js";

let pipedLines; // un solo lector compartido: si cada pregunta abriera el suyo, el primero se quedaría todas las líneas

function askHidden(prompt) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    pipedLines ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    return pipedLines.next().then((r) => { process.stdout.write("\n"); return r.done ? "" : r.value; });
  }
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

const dni = (process.argv[2] || "").trim().toUpperCase();
await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/notas-ia");
try {
  if (!dni) {
    const admins = await User.find({ role: "admin" }, "name dni").lean();
    console.log("Uso: node src/resetAdmin.js <DNI>\nAdmins existentes:");
    for (const a of admins) console.log(`  ${a.dni}  ${a.name}`);
    process.exitCode = 1;
  } else {
    const user = await User.findOne({ dni, role: "admin" });
    if (!user) {
      console.error(`No hay ningún admin con DNI ${dni}.`);
      process.exitCode = 1;
    } else {
      const pw = await askHidden(`Nueva contraseña para ${user.name}: `);
      const again = await askHidden("Repítela: ");
      if (pw.length < 4) { console.error("Necesita al menos 4 caracteres."); process.exitCode = 1; }
      else if (pw !== again) { console.error("Las contraseñas no coinciden."); process.exitCode = 1; }
      else {
        user.passwordHash = hashPassword(pw);
        await user.save();
        await Session.deleteMany({ user: user._id });
        await ActivityLog.create({ actorName: "Consola del servidor", actorDni: "-", action: "user.password-reset", target: `${user.name} (${user.dni})` });
        console.log("Contraseña cambiada. Se han cerrado sus sesiones abiertas.");
      }
    }
  }
} finally {
  await mongoose.disconnect();
}
