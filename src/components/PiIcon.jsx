/** The pi logo; `size` in px. */
export function PiIcon({ size = 14, className = "" }) {
  return <img className={`pw-pi-icon ${className}`.trim()} src="/pi.svg" width={size} height={size} alt="" />
}
