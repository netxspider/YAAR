const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const MicIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const MicOffIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></svg>
);
export const KeyboardIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>
);
export const StopIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
);
export const MenuIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M4 8h16M4 16h10" /></svg>
);
export const CloseIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const SendIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const ShuffleIcon = () => (
  <svg {...base} width={18} height={18} aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
);
export const PlayIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><path d="M7 5v14l11-7z" /></svg>
);
export const TrashIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
