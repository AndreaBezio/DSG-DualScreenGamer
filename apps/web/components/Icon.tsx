// Small line icons, drawn for DSG (24x24 grid, currentColor).
const PATHS: Record<string, string> = {
  game: 'M6 9h4M8 7v4M15 10h.01M18 8h.01M7 4h10a5 5 0 0 1 5 5v2a5 5 0 0 1-8.5 3.5L12 13l-1.5 1.5A5 5 0 0 1 2 11V9a5 5 0 0 1 5-5z',
  dual_screen_layout: 'M5 2h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7 13h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  texture_pack: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9h.01',
  patch: 'M14.5 4.5l5 5L9.5 19.5l-5-5zM12 7l5 5M10 13h.01M13 10h.01M11 15h.01M15 11h.01',
  companion_app: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  shader: 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z',
  utility: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12l5 5L20 7',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name] ?? PATHS.game} />
    </svg>
  );
}
