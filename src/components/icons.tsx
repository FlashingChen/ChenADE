import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': true as const,
    focusable: 'false' as const,
  };
}

export function BranchIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.6" cy="3.6" r="1.5" />
      <circle cx="4.6" cy="12.4" r="1.5" />
      <circle cx="11.4" cy="5.8" r="1.5" />
      <path d="M4.6 5.1v5.8" />
      <path d="M11.4 7.3c0 2.6-1.7 3.9-3.9 4.4" />
    </svg>
  );
}

export function FolderIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.4 5.4V4.1a.9.9 0 0 1 .9-.9h2.6L7.2 4.7h4.6a.9.9 0 0 1 .9.9v6a.9.9 0 0 1-.9.9H3.3a.9.9 0 0 1-.9-.9z" />
    </svg>
  );
}

export function FolderOpenIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.4 5.4V4.1a.9.9 0 0 1 .9-.9h2.6L7.2 4.7h4.5a.9.9 0 0 1 .9.9v1.1" />
      <path d="M2.9 12.9h9.4l1.2-5.1H3.9z" />
    </svg>
  );
}

export function FileIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 2.4h4.4l3.2 3.2v8H4.2z" />
      <path d="M8.6 2.4v3.2h3.2" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <circle cx="7" cy="7" r="4" />
      <path d="M10.1 10.1 13 13" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className, style, strokeWidth = 1.4 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <path d="M8 3.6v8.8M3.6 8h8.8" />
    </svg>
  );
}

export function XIcon({ size = 16, className, style, strokeWidth = 1.4 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" />
    </svg>
  );
}

export function MoreIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="currentColor">
      <circle cx="3.6" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.4" cy="8" r="1.15" />
    </svg>
  );
}

export function TerminalIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.2 4.8 6.4 8l-3.2 3.2" />
      <path d="M8.6 11.4h4.2" />
    </svg>
  );
}

export function SplitIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M8 3v10" />
    </svg>
  );
}

export function DiffIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.6" />
      <path d="M8 2.8v10.4" />
      <path d="M5.2 6.2h1.1M5.2 8.6h1.5M10.8 6.2h-1.1M10.8 8.6h-1.5" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.8 6.6A5 5 0 1 0 13 9.4" />
      <path d="M12.8 3v3.8H9" />
    </svg>
  );
}

export function ChevronIcon({ size = 16, className, style, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.2 3.8 10.4 8l-4.2 4.2" />
    </svg>
  );
}

export function GearIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 2.3v1.5M8 12.2v1.5M2.3 8h1.5M12.2 8h1.5M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1" />
    </svg>
  );
}

export function CommitIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M2.4 8h3.1M10.5 8h3.1" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className, style, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.4 8.4 6.4 11.4 12.6 5" />
    </svg>
  );
}

export function ArrowIcon({ size = 16, className, style, strokeWidth = 1.4 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 11 11 5" />
      <path d="M6.2 5H11v4.8" />
    </svg>
  );
}

export function SendIcon({ size = 16, className, style, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12.6V3.6" />
      <path d="M4.4 7.2 8 3.6l3.6 3.6" />
    </svg>
  );
}

export function StopIcon({ size = 16, className, style, strokeWidth = 1.25 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round">
      <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.4" />
    </svg>
  );
}

export function AttachIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.9 7.4 7.6 11.7a2.4 2.4 0 0 1-3.4-3.4l4.9-4.9a1.7 1.7 0 0 1 2.4 2.4L6.6 10a.85.85 0 0 1-1.2-1.2l3.9-3.9" />
    </svg>
  );
}

export function TrashIcon({ size = 16, className, style, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.2 4.8h9.6M6 4.8V3.4h4v1.4M4.6 4.8l.5 8.2h5.8l.5-8.2M6.6 7v3.8M9.4 7v3.8" />
    </svg>
  );
}

export function LogoMark({ size = 16, className, style }: IconProps) {
  return (
    <img
      src="/brand/mark.svg"
      width={size}
      height={size}
      className={className}
      style={style}
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
