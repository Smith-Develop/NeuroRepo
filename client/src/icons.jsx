// Iconos SVG en línea (en vez de emoji): en varias máquinas sin fuente de emojis a color se ven
// como un garabato roto (ya nos pasó con los iconos de archivo, ver DocumentCard.jsx). Mismo
// lenguaje visual que el prototipo de referencia (trazo, sin relleno, extremos redondeados).
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };

function Icon({ size = 16, children, className = "", ...rest }) {
  return <svg width={size} height={size} aria-hidden="true" className={`i ${className}`} {...base} {...rest}>{children}</svg>;
}

export function ChatIcon(props) {
  return <Icon {...props}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon>;
}
export function FolderIcon({ filled, ...props }) {
  return <Icon {...props}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.22 : undefined} /></Icon>;
}
export function UsersIcon(props) {
  return <Icon {...props}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3.6 2.9-6 5.5-6s5.5 2.4 5.5 6" /><circle cx="17.5" cy="9" r="2.5" /><path d="M15.6 13.1c2.4.4 4.1 2.5 4.1 5.3" /></Icon>;
}
export function LockIcon(props) {
  return <Icon {...props}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>;
}
export function LinkIcon(props) {
  return <Icon {...props}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>;
}
export function SearchIcon(props) {
  return <Icon {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
}
export function ChevronDownIcon(props) {
  return <Icon {...props}><path d="m7 10 5 5 5-5" /></Icon>;
}
export function ChevronRightIcon(props) {
  return <Icon {...props}><path d="m10 7 5 5-5 5" /></Icon>;
}
export function DotsIcon(props) {
  return <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
}
export function EditIcon(props) {
  return <Icon {...props}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m14 6 4 4" /></Icon>;
}
export function TrashIcon(props) {
  return <Icon {...props}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Icon>;
}
export function RefreshIcon(props) {
  return <Icon {...props}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></Icon>;
}
export function UploadIcon(props) {
  return <Icon {...props}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Icon>;
}
export function EyeIcon(props) {
  return <Icon {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>;
}
export function PlusIcon(props) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}
export function UserPlusIcon(props) {
  return <Icon {...props}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3.6 2.9-6 5.5-6s5.5 2.4 5.5 6M18 8v6M15 11h6" /></Icon>;
}
export function ShieldIcon(props) {
  return <Icon {...props}><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></Icon>;
}
export function HomeIcon(props) {
  return <Icon {...props}><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></Icon>;
}
export function XIcon(props) {
  return <Icon {...props}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
}
export function CheckIcon(props) {
  return <Icon {...props}><path d="m5 12 5 5 9-10" /></Icon>;
}
export function InfoIcon(props) {
  return <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>;
}
export function ListIcon(props) {
  return <Icon {...props}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Icon>;
}
export function GridIcon(props) {
  return <Icon {...props}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></Icon>;
}
export function ActivityIcon(props) {
  return <Icon {...props}><path d="M3 12h4l3-8 4 16 3-8h4" /></Icon>;
}
export function UpArrowIcon(props) {
  return <Icon {...props}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>;
}
export function LogoutIcon(props) {
  return <Icon {...props}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></Icon>;
}
export function HistoryIcon(props) {
  return <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>;
}
export function RestoreIcon(props) {
  return <Icon {...props}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>;
}
export function SunIcon(props) {
  return <Icon {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
}
export function KeyIcon(props) {
  return <Icon {...props}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></Icon>;
}
export function CalendarIcon(props) {
  return <Icon {...props}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></Icon>;
}
export function FileIcon(props) {
  return <Icon {...props}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;
}
export function WrenchIcon(props) {
  return <Icon {...props}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></Icon>;
}
export function CopyIcon(props) {
  return <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>;
}
export function ThumbIcon(props) {
  return <Icon {...props}><path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.4 20H7" /></Icon>;
}
export function SparkleIcon(props) {
  return <Icon {...props}><path d="M12 3c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z" /></Icon>;
}
export function SendRequestIcon(props) {
  return <Icon {...props}><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" /></Icon>;
}
export function DbIcon(props) {
  return <Icon {...props}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></Icon>;
}

export function DownloadIcon(props) {
  return <Icon {...props}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
}
export function StarIcon({ filled, ...props }) {
  return <Icon {...props}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill={filled ? "currentColor" : "none"} /></Icon>;
}
