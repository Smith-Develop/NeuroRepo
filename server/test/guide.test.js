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
  assert.equal(searchGuide(entries, "acceso a la VPN")[0].title, "Altas · VPN Escritorio o VPN HCIS");
  assert.equal(searchGuide(entries, "que con los").length, 0);
});
