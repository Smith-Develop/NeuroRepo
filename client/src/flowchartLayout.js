// Geometría y resolución de destinos compartidas entre Flowchart.jsx (solo lectura) y FlowchartEditor.jsx.
export const ROW_H = 110;
export const BOX_W = 220;
export const BOX_H = 56;
export const CX = 170;
export const SIDE_L = CX - BOX_W / 2 - 70; // por donde curva la rama "Sí"
export const SIDE_R = CX + BOX_W / 2 + 70; // por donde curva la rama "No"
export const TOP = 30;

export const yOf = (i) => TOP + i * ROW_H;

// A qué paso va cada rama de una decisión: si no se ha fijado, por defecto sigue al siguiente paso.
// Los pasos normales solo tienen "next" (el siguiente del array).
export function targetsOf(steps, i) {
  const s = steps[i];
  const fallback = i + 1 < steps.length ? i + 1 : null;
  if (s.type !== "decision") return { next: fallback };
  return {
    yes: s.yesTarget != null ? s.yesTarget : fallback,
    no: s.noTarget != null ? s.noTarget : fallback,
  };
}

export function shapePoints(type) {
  return type === "decision" ? `${BOX_W / 2},0 ${BOX_W},${BOX_H / 2} ${BOX_W / 2},${BOX_H} 0,${BOX_H / 2}` : null;
}
