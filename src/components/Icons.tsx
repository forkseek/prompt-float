import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      {...props}
    >
      {children}
    </svg>
  );
}

const strokeProps = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
};

export function SparklesIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3.5c.65 3.4 2.1 4.85 5.5 5.5-3.4.65-4.85 2.1-5.5 5.5-.65-3.4-2.1-4.85-5.5-5.5 3.4-.65 4.85-2.1 5.5-5.5Z" {...strokeProps} />
      <path d="M18.2 14.5c.35 1.8 1.1 2.55 2.8 2.9-1.7.35-2.45 1.1-2.8 2.85-.35-1.75-1.1-2.5-2.85-2.85 1.75-.35 2.5-1.1 2.85-2.9Z" {...strokeProps} />
      <path d="M5.1 14.6c.25 1.25.8 1.8 2.05 2.05-1.25.25-1.8.8-2.05 2.05-.25-1.25-.8-1.8-2.05-2.05 1.25-.25 1.8-.8 2.05-2.05Z" {...strokeProps} />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3" {...strokeProps} />
      <path d="M19 13.7a7.3 7.3 0 0 0 0-3.4l2-1.55-2-3.45-2.45 1A7.2 7.2 0 0 0 13.6 4L13.2 1.5h-4L8.8 4a7.2 7.2 0 0 0-2.95 2.3l-2.45-1-2 3.45 2 1.55a7.3 7.3 0 0 0 0 3.4l-2 1.55 2 3.45 2.45-1A7.2 7.2 0 0 0 8.8 20l.4 2.5h4l.4-2.5a7.2 7.2 0 0 0 2.95-2.3l2.45 1 2-3.45-2-1.55Z" {...strokeProps} />
    </IconFrame>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3.6" {...strokeProps} />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" {...strokeProps} />
    </IconFrame>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20.2 15.25A8.3 8.3 0 0 1 8.75 3.8 8.3 8.3 0 1 0 20.2 15.25Z" {...strokeProps} />
    </IconFrame>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="4" width="18" height="13" rx="2" {...strokeProps} />
      <path d="M8 21h8M12 17v4" {...strokeProps} />
    </IconFrame>
  );
}

export function MinimizeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 12h12" {...strokeProps} />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m7 7 10 10M17 7 7 17" {...strokeProps} />
    </IconFrame>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7 17 17 7M8 7h9v9" {...strokeProps} />
    </IconFrame>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" {...strokeProps} />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...strokeProps} />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m5 12.5 4 4L19 6.5" {...strokeProps} />
    </IconFrame>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9 7 4 12l5 5" {...strokeProps} />
      <path d="M5 12h8a6 6 0 0 1 6 6" {...strokeProps} />
    </IconFrame>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3.5 11.5a8.5 8.5 0 1 1 2.2 6.3M3.5 16.5v-5h5" {...strokeProps} />
      <path d="M12 7.5v5l3.4 2" {...strokeProps} />
    </IconFrame>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" {...strokeProps} />
    </IconFrame>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2.5" {...strokeProps} />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" {...strokeProps} />
    </IconFrame>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M10.2 4.4 2.9 17a2 2 0 0 0 1.73 3h14.74a2 2 0 0 0 1.73-3L13.8 4.4a2 2 0 0 0-3.6 0Z" {...strokeProps} />
      <path d="M12 9v4M12 16.5v.1" {...strokeProps} />
    </IconFrame>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m7 9.5 5 5 5-5" {...strokeProps} />
    </IconFrame>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="6" cy="6" r="2.25" {...strokeProps} />
      <circle cx="18" cy="18" r="2.25" {...strokeProps} />
      <path d="M8.25 6h3.25a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h.25" {...strokeProps} />
      <path d="m12.5 12 2 2 2-2" {...strokeProps} />
    </IconFrame>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M13.5 5.5 18.5 10.5M4 20l3.8-.8L19.5 7.5a2.12 2.12 0 0 0-3-3L4.8 16.2 4 20Z" {...strokeProps} />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 5v14M5 12h14" {...strokeProps} />
    </IconFrame>
  );
}
