import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGuide, searchGuide } from "../src/guide.js";

// Mismo formato que la guía real (bloques separados por líneas de guiones), con datos inventados
const TEXTO = `Tenemos 3 Unidades, se mapean al hacer login.

Unidad U: Informacion personal del usuario.
Unidad G: Informacion del Servicio.

------------------------------------------------------------

Restaurar Archivos.
opcion 1, Mirar que no haya sido movido.
Opcion 2, Versiones Anteriores.
Opcion 3, Servidor de copias mensuales.

-----------------------------------------------------

[solo admin] Conexiones servidor investigacion.
usuario demo
contraseña: Inventada@2020

----------------------------------------------------------

Direccionamiento IP.
Ver el documento con todos los centros dependientes.

----------------------------------------------------------

- 
PARA VER CORREOS DESDE LA CALLE
https://correo.ejemplo.org

----------------------------------------------------------

Altas · VPN Escritorio o VPN HCIS
Añadir al grupo gVPN_HULP_GAR_2.

----------------------------------------------------------

Teléfonos.
Si queremos llamar a moviles pulsamos el 0 y marcamos movil.
Centralita marcamos el 9 y esperamos
`;

test("parseGuide separa por líneas de guiones y detecta [solo admin]", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(entries.length, 7);
  assert.equal(entries[1].title, "Restaurar Archivos.");
  assert.equal(entries[2].adminOnly, true);
  assert.equal(entries[2].title, "Conexiones servidor investigacion.");
  assert.ok(!entries[2].body.includes("[solo admin]"));
});

test("searchGuide encuentra la entrada aunque cambien tildes y formas de la palabra", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(searchGuide(entries, "¿Cómo restauro un archivo borrado?")[0].title, "Restaurar Archivos.");
  assert.equal(searchGuide(entries, "como llamo a la centralita")[0].title, "Teléfonos.");
});

test("las entradas [solo admin] no salen a usuarios normales", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(searchGuide(entries, "contraseña servidor investigacion").length, 0);
  assert.equal(searchGuide(entries, "contraseña servidor investigacion", { isAdmin: true })[0].adminOnly, true);
});

test("sin coincidencias suficientes no devuelve nada", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(searchGuide(entries, "presupuesto de la cafeteria").length, 0);
});

test("el título salta líneas sin texto (guiones o viñetas sueltas)", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(entries[4].title, "PARA VER CORREOS DESDE LA CALLE");
});

test("una palabra entera pesa más que una raíz parecida («centralita» frente a «centros»)", () => {
  const r = searchGuide(parseGuide(TEXTO), "como llamo a la centralita");
  assert.equal(r[0].title, "Teléfonos.");
  assert.equal(r.length, 1);
});

test("las siglas de 3 letras (VPN) cuentan como palabra entera", () => {
  const entries = parseGuide(TEXTO);
  assert.equal(searchGuide(entries, "acceso a la VPN")[0].title, "VPN Escritorio o VPN HCIS");
  assert.equal(searchGuide(entries, "que con los").length, 0);
});

// --- Fichas ---------------------------------------------------------------------------------------
import { parseGuideText, renderBody, exportText, sanitizeEntry, checkDuplicates } from "../src/guide.js";
import { parseSynonyms } from "../src/search.js";

const FICHAS = `Altas de aplicaciones · Ambulancias (TSNU)

Acceso permitido a: Administrativos
Dirección: https://tsnu.ejemplo.org/Login.aspx
Cómo se tramita el alta: Desde GestiónAI
Cómo se pide: formulario «Solicitud Usuarios Aplic.»
Observaciones: Para la pestaña validación, incidencia a CESUS

------------------------------------------------------------

Altas de aplicaciones · SMS

Cómo se da el acceso: añadir al usuario (o al equipo) al grupo del directorio activo:
- gHULPSMS
- y
- gHULPCONSSMS
Quién lo solicita: Asuntos Generales

------------------------------------------------------------

Soporte · Control remoto (VNC)

Se accede por VNC.
1. Llamamos al usuario.
2. Le pedimos la IP:
   está en la esquina del escritorio.
3. Nos conectamos.

------------------------------------------------------------

[solo admin] Accesos · Administrador local
usuario: demo
clave: Inventada1

------------------------------------------------------------

Red · Proxy

proxy.ejemplo.org puerto 8080
`;

test("el .txt se convierte en fichas del tipo que corresponde", () => {
  const f = parseGuideText(FICHAS);
  assert.deepEqual(f.map((e) => e.type), ["aplicacion", "aplicacion", "procedimiento", "acceso", "nota"]);
  assert.equal(f[0].category, "Altas de aplicaciones");
  assert.equal(f[0].title, "Ambulancias (TSNU)");
  assert.equal(f[0].fields.url, "https://tsnu.ejemplo.org/Login.aspx");
  assert.equal(f[0].fields.pide, "formulario «Solicitud Usuarios Aplic.»");
  assert.deepEqual(f[1].fields.grupos, ["gHULPSMS", "gHULPCONSSMS"]);
  assert.equal(f[1].fields.solicita, "Asuntos Generales");
  assert.equal(f[2].content, "Se accede por VNC.");
  assert.equal(f[2].fields.pasos.length, 3);
  assert.equal(f[2].fields.pasos[1], "Le pedimos la IP:\nestá en la esquina del escritorio.");
  assert.equal(f[3].adminOnly, true);
  assert.equal(f[4].content, "proxy.ejemplo.org puerto 8080");
});

test("exportar y volver a importar da las mismas fichas", () => {
  const f = parseGuideText(FICHAS).map((e) => ({ ...e, keywords: ["clave"] }));
  const again = parseGuideText(exportText(f));
  assert.deepEqual(again, f);
});

test("renderBody pone los campos con su etiqueta y los pasos numerados", () => {
  const [, sms, vnc] = parseGuideText(FICHAS);
  assert.match(renderBody(sms), /Grupos del directorio activo.*\n- gHULPSMS\n- gHULPCONSSMS/);
  assert.match(renderBody(vnc), /^Se accede por VNC\.\n\n1\. Llamamos al usuario\.\n2\. Le pedimos la IP:\n   está/);
});

test("sanitizeEntry: título obligatorio y las de acceso siempre solo admin", () => {
  assert.ok(sanitizeEntry({ title: "  " }).error);
  assert.equal(sanitizeEntry({ title: "X", type: "acceso" }).adminOnly, true);
  assert.equal(sanitizeEntry({ title: "X", type: "raro" }).type, "nota");
  assert.deepEqual(sanitizeEntry({ title: "X", type: "nota", fields: { url: "http://a" } }).fields, {});
});

test("checkDuplicates avisa de título igual, títulos parecidos, grupos y direcciones repetidas", () => {
  const others = parseGuideText(FICHAS).map((e, i) => ({ ...e, _id: String(i) }));
  const r = checkDuplicates({ category: "altas de aplicaciones", title: "ambulancias (tsnu)", fields: { grupos: ["ghulpsms"], url: "tsnu.ejemplo.org/Login.aspx/" } }, others);
  assert.equal(r.same._id, "0");
  assert.equal(r.grupos[0].entries[0]._id, "1");
  assert.equal(r.url[0]._id, "0");
  assert.equal(checkDuplicates({ category: "Otra", title: "Ambulancia TSNU" }, others).similar[0]._id, "0");
});

test("sinónimos y erratas: la ficha sale aunque la pregunta use otra palabra o esté mal escrita", () => {
  const entries = parseGuide(FICHAS);
  const lexicon = { synonyms: parseSynonyms("vnc, control remoto, conectarme al equipo"), vocab: null };
  assert.equal(searchGuide(entries, "como hago control remoto", { lexicon })[0].title, "Control remoto (VNC)");
  assert.equal(searchGuide(entries, "conectarme al equipo de un usuario", { lexicon })[0].title, "Control remoto (VNC)");
  const words = new Set(["ambulancias", "proxy", "administrativos"]);
  const typo = { synonyms: [], vocab: { words, stems: new Set([...words].map((w) => w.slice(0, 5))) } };
  assert.equal(searchGuide(entries, "alta en anbulancias", { lexicon: typo })[0].title, "Ambulancias (TSNU)");
});

test("el título y la categoría pesan más que el contenido", () => {
  const entries = parseGuide(`Red · Proxy\n\nSe configura en el navegador.\n\n-----\n\nNavegador · Ajustes\n\nEl proxy se pone aquí y también otras cosas del navegador.`);
  assert.equal(searchGuide(entries, "proxy navegador")[0].title, "Proxy");
});
