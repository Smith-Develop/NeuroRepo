import { ActivityLog } from "./models.js";

// Registra quién hizo qué. Nunca debe romper la acción real que la originó.
export async function logActivity(req, action, target = "") {
  try {
    await ActivityLog.create({ actorName: req.user?.name ?? "?", actorDni: req.user?.dni ?? "?", action, target });
  } catch (e) {
    console.error("No se pudo registrar actividad:", e);
  }
}
