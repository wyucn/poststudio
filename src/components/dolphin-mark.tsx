import { cn } from "@/lib/utils";

/**
 * 品牌图形：海豚背鳍破浪 —— 「海豚后期」的极简标识。
 * 实心背鳍 + 描边波浪，使用 currentColor，可随文字颜色变化。
 */
export function DolphinMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      {/* 背鳍（镰刀形） */}
      <path
        d="M19.5 4.5
           C13.5 8, 10.4 12.8, 9.8 18.5
           L19.8 18.5
           C18.5 13.8, 18.6 9, 19.5 4.5
           Z"
        fill="currentColor"
      />
      {/* 波浪 */}
      <path
        d="M3 23.5
           C5.8 21, 8.7 21, 11.5 23.5
           C14.3 26, 17.2 26, 20 23.5
           C22.8 21, 25.7 21, 28.5 23.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* 水花 */}
      <circle cx="24.5" cy="8.5" r="1.3" fill="currentColor" opacity="0.7" />
      <circle cx="27" cy="13" r="1" fill="currentColor" opacity="0.45" />
    </svg>
  );
}
