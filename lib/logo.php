<?php
/* شعار المدرسة — يعرض الشعار المرفوع من الإعدادات، وإن لم يوجد يعرض شعاراً افتراضياً */
if (!function_exists('renderLogo')) {
    function renderLogo(string $class = 'logo-img', int $h = 46): string {
        $p = setting('logo_path', '');
        if ($p && file_exists(__DIR__ . '/../' . $p))
            return '<img class="' . e($class) . '" src="' . e($p) . '?v=' . filemtime(__DIR__ . '/../' . $p) . '" alt="شعار المدرسة" style="height:' . $h . 'px">';
        return defaultLogoSvg($h);
    }
    function defaultLogoSvg(int $h = 46): string {
        $w = (int) round($h * 300 / 62);
        return '<svg viewBox="0 0 300 62" width="' . $w . '" height="' . $h . '" style="direction:ltr;flex:0 0 auto"
     xmlns="http://www.w3.org/2000/svg" role="img" aria-label="مدارس المكتشف العالمية">
  <g transform="translate(256,4)">
    <ellipse cx="19" cy="27" rx="17" ry="25" fill="#1b3a63"/>
    <path d="M19 2a17 25 0 0 1 0 50z" fill="#c8102e"/>
    <g stroke="#fff" stroke-width="1.3" fill="none" opacity=".95">
      <ellipse cx="19" cy="27" rx="17" ry="25"/><ellipse cx="19" cy="27" rx="6.5" ry="25"/>
      <line x1="2" y1="27" x2="36" y2="27"/><path d="M5.5 14h27M5.5 40h27"/>
    </g>
  </g>
  <text x="8" y="34" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="800"
        fill="#12294a" letter-spacing="1">MIS</text>
  <rect x="8" y="40" width="150" height="2.4" fill="#c8102e"/>
  <text x="8" y="55" font-family="Arial,Helvetica,sans-serif" font-size="9.5" font-weight="600"
        fill="#12294a">Al Moktashef International Schools</text>
</svg>';
    }
}
echo renderLogo('logo-img', 64);
