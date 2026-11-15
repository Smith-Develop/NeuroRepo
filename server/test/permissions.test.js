import { test } from "node:test";
import assert from "node:assert/strict";
import { canSeeFolder, folderFilter, folderAncestors } from "../src/auth.js";

const user = (folders) => ({ role: "user", group: folders ? { folders } : null });
const admin = { role: "admin", group: null };

test("una ruta permitida incluye la propia carpeta y todas sus subcarpetas", () => {
  const u = user(["Calidad/Procedimientos"]);
  assert.equal(canSeeFolder(u, "Calidad/Procedimientos"), true);
  assert.equal(canSeeFolder(u, "Calidad/Procedimientos/2024/Enero"), true);
  assert.equal(canSeeFolder(u, "Calidad"), false);
  assert.equal(canSeeFolder(u, "Calidad/Auditorias"), false);
});

test("un prefijo de texto no es un prefijo de carpeta", () => {
  const u = user(["Cal"]);
  assert.equal(canSeeFolder(u, "Calidad"), false);
  assert.equal(canSeeFolder(u, "Cal/x"), true);
  assert.equal(canSeeFolder(user(["Calidad/Proc"]), "Calidad/Procedimientos"), false);
});

test("sin grupo no se ve nada, y la raíz solo la ve el admin", () => {
  assert.equal(canSeeFolder(user(null), "Calidad"), false);
  assert.equal(canSeeFolder(user([]), "Calidad"), false);
  assert.equal(canSeeFolder(user(["Calidad"]), ""), false);
  assert.equal(canSeeFolder(admin, ""), true);
  assert.equal(canSeeFolder(admin, "Lo/que/sea"), true);
});

test("los nombres de primer nivel de antes siguen funcionando igual", () => {
  const u = user(["RRHH", "IT"]);
  assert.equal(canSeeFolder(u, "RRHH"), true);
  assert.equal(canSeeFolder(u, "IT/Redes"), true);
  assert.equal(canSeeFolder(u, "Finanzas"), false);
});

test("folderFilter equivale a canSeeFolder y escapa los caracteres especiales", () => {
  assert.deepEqual(folderFilter(admin), {});
  assert.deepEqual(folderFilter(user(null)), { _id: { $exists: false } });
  const { $or } = folderFilter(user(["Fotos (2024)", "a.b"]));
  const matches = (folder) => $or.some((c) => (typeof c.folder === "string" ? c.folder === folder : new RegExp(c.folder.$regex).test(folder)));
  for (const folder of ["Fotos (2024)", "Fotos (2024)/x", "a.b", "a.b/c", "Fotos (2024)x", "aXb", "a.bc", "Fotos 2024"]) {
    assert.equal(matches(folder), canSeeFolder(user(["Fotos (2024)", "a.b"]), folder), folder);
  }
});

test("folderAncestors devuelve la cadena de carpetas de arriba abajo", () => {
  assert.deepEqual(folderAncestors("a/b/c"), ["a", "a/b", "a/b/c"]);
  assert.deepEqual(folderAncestors(""), []);
});
