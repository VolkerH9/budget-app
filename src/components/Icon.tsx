const PATHS = {
  overview: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6" /></>,
  list: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.5" cy="6.5" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="17.5" r="1" fill="currentColor" /></>,
  budget: <><rect x="3.5" y="6" width="17" height="13" rx="3" /><path d="M3.5 10.5h17M15 15h2.5" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  back: <path d="M9 18l6-6-6-6" transform="rotate(90 12 12)" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.5" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="3" /><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" /></>,
  repeat: <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0l-3-3m3 3l-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0l3-3m-3 3l3 3" />,
  backspace: <><path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7z" /><path d="M12.5 9.5l5 5m0-5l-5 5" /></>,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  face: <><path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.500 4h2A2.500 2.500 0 0 1 20 6.500v2M20 15.500v2a2.500 2.500 0 0 1-2.500 2.500h-2M8.500 20h-2A2.500 2.500 0 0 1 4 17.500v-2" /><path d="M9 9v1.500M15 9v1.500M12 9v3.500h-1M9 15.500a4.500 4.500 0 0 0 6 0" /></>,
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 24, width = 1.9 }: { name: IconName; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
