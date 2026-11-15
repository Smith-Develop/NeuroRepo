import { ChevronRightIcon, HomeIcon } from "./icons";

export default function Crumbs({ items }) {
  return (
    <div className="crumbs">
      <HomeIcon size={12} />
      {items.map((it, i) => (
        <span key={it} style={{ display: "flex", alignItems: "center", gap: 6, color: i === items.length - 1 ? "var(--text)" : undefined }}>
          {i > 0 && <ChevronRightIcon size={12} />}
          {it}
        </span>
      ))}
    </div>
  );
}
