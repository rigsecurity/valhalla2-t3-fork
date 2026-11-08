import "./rig-atmosphere.css";

const contours = Array.from({ length: 14 }, (_, index) => {
  const offset = index * 16;
  return `M -100 ${420 + offset} C 156 ${463 + offset} 302 ${374 + offset} 461 ${310 + offset} S 723 ${136 + offset * 0.6} 890 ${176 + offset * 0.9} S 1090 ${261 + offset * 1.15} 1300 ${53 + offset * 1.3}`;
});

export function RigAtmosphere({ arrive = false }: { arrive?: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        data-rig-atmosphere-wash
        data-arrive={arrive ? "" : undefined}
      />
      <svg
        className="absolute inset-0 size-full"
        data-rig-atmosphere-contours
        viewBox="0 0 1200 610"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        {contours.map((path) => (
          <path key={path} d={path} stroke="currentColor" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}
