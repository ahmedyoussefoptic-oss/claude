import logo from '../../assets/logo.png';

// A faint, centered, click-through school logo shown behind page content.
// Uses `fixed` positioning so it stays put while the page scrolls; the
// container using this must give its actual content `relative z-10` (or
// higher) so the content paints above it.
export default function Watermark({ opacity = 0.05, size = '45%' }) {
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className="pointer-events-none select-none fixed inset-0 m-auto max-w-lg object-contain z-0"
      style={{ opacity, width: size }}
    />
  );
}
