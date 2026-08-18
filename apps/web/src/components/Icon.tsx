import React from "react";
import type { SVGProps } from "react";

export type IconName =
  | "plus"
  | "more"
  | "x"
  | "search"
  | "chevron-down"
  | "check"
  | "menu"
  | "doc"
  | "milestone"
  | "tag"
  | "image"
  | "trash"
  | "drag"
  | "pin"
  | "link"
  | "clock"
  | "alert"
  | "archive"
  | "pencil";

const icons: Record<IconName, React.ReactElement> = {
  plus: (
    <>
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </>
  ),

  more: (
    <>
      <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  x: (
    <>
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </>
  ),

  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" />
    </>
  ),

  "chevron-down": (
    <polyline points="3,6 8,11 13,6" />
  ),

  check: (
    <polyline points="2,8 6,12 14,4" />
  ),

  menu: (
    <>
      <line x1="2" y1="4.5" x2="14" y2="4.5" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="11.5" x2="14" y2="11.5" />
    </>
  ),

  doc: (
    <path d="M4 2h6l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M10 2v4h4" />
  ),

  milestone: (
    <path d="M8 2L14 8L8 14L2 8Z" />
  ),

  tag: (
    <path d="M2 2h5.5l6.5 6.5a1 1 0 0 1 0 1.414l-3.586 3.586a1 1 0 0 1-1.414 0L3 7V2h0zM2 2h5.5M5.5 5.5h.01" />
  ),

  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <polyline points="2,10 5,7 8,9.5 11,6.5 14,9" />
      <circle cx="5.5" cy="6" r="1" />
    </>
  ),

  trash: (
    <>
      <polyline points="2,4.5 14,4.5" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M3.5 4.5l.75 8.5a1 1 0 0 0 1 .917h5.5a1 1 0 0 0 1-.917l.75-8.5" />
      <line x1="6.5" y1="7" x2="6.5" y2="11" />
      <line x1="9.5" y1="7" x2="9.5" y2="11" />
    </>
  ),

  drag: (
    <>
      <circle cx="5.5" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  pin: (
    <path d="M9.5 2.5L13.5 6.5L10 10L8.5 13.5L7 12L4.5 14L2 11.5L4 9L2.5 7.5L6 6L9.5 2.5Z M6 6L10 10" />
  ),

  link: (
    <>
      <path d="M6.5 9.5a3.536 3.536 0 0 0 5 0l2-2a3.536 3.536 0 0 0-5-5l-1 1" />
      <path d="M9.5 6.5a3.536 3.536 0 0 0-5 0l-2 2a3.536 3.536 0 0 0 5 5l1-1" />
    </>
  ),

  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,4.5 8,8 10.5,9.5" />
    </>
  ),

  alert: (
    <>
      <path d="M8 2L14.5 13.5H1.5Z" />
      <line x1="8" y1="7" x2="8" y2="10" />
      <circle cx="8" cy="11.75" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),

  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="0.5" />
      <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
      <polyline points="6,9.5 8,11.5 10,9.5" />
      <line x1="8" y1="7.5" x2="8" y2="11.5" />
    </>
  ),

  pencil: (
    <>
      <path d="M11.5 2.5l2 2a1 1 0 0 1 0 1.414L5.5 14H2v-3.5l8.086-8.086a1 1 0 0 1 1.414 0z" />
      <line x1="9.5" y1="4.5" x2="11.5" y2="6.5" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {icons[name]}
    </svg>
  );
}
