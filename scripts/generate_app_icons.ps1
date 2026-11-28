# Genera los iconos de Manager Stock (logo: cubo isométrico blanco sobre degradado naranja)
# para Android, la app de escritorio (Windows) y la web, dibujándolos en vectorial con
# System.Drawing para que se vean nítidos en cualquier tamaño.
# Uso (desde la raíz del proyecto):  powershell -ExecutionPolicy Bypass -File scripts\generate_app_icons.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$bgStart = [Drawing.ColorTranslator]::FromHtml('#EAA256')   # esquina superior izquierda
$bgEnd   = [Drawing.ColorTranslator]::FromHtml('#DA7F39')   # esquina inferior derecha
$top     = [Drawing.ColorTranslator]::FromHtml('#FFFFFF')
$left    = [Drawing.ColorTranslator]::FromHtml('#F9E1BF')
$right   = [Drawing.ColorTranslator]::FromHtml('#F4C188')
$edge    = [Drawing.ColorTranslator]::FromHtml('#E08E44')

function New-Logo([int]$size, [double]$radius, [string]$shape) {
    # $radius: radio del cubo como fracción del lado. $shape: none | square | rounded | circle
    $bmp = New-Object Drawing.Bitmap $size, $size
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
    $g.Clear([Drawing.Color]::Transparent)
    if ($shape -ne 'none') {
        $rect = New-Object Drawing.RectangleF 0, 0, $size, $size
        $brush = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, $bgStart, $bgEnd, 45
        $path = New-Object Drawing.Drawing2D.GraphicsPath
        switch ($shape) {
            'square'  { $path.AddRectangle($rect) }
            'circle'  { $path.AddEllipse($rect) }
            'rounded' {
                $r = $size * 0.22; $d = 2 * $r
                $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($size - $d, 0, $d, $d, 270, 90)
                $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $path.AddArc(0, $size - $d, $d, $d, 90, 90)
                $path.CloseFigure()
            }
        }
        $g.FillPath($brush, $path)
    }
    $R = $size * $radius; $cx = $size / 2; $cy = $size / 2
    $k = [Math]::Sqrt(3) / 2
    $P = { param([double]$x, [double]$y) New-Object Drawing.PointF ([single]($cx + $x * $R)), ([single]($cy + $y * $R)) }
    $T = & $P 0 -1; $UR = & $P $k -0.5; $LR = & $P $k 0.5; $B = & $P 0 1; $LL = & $P (-$k) 0.5; $UL = & $P (-$k) -0.5; $C = & $P 0 0
    # Halo suave alrededor del cubo, como en el logo.
    $halo = @( (& $P 0 -1.13), (& $P ($k * 1.13) -0.565), (& $P ($k * 1.13) 0.565), (& $P 0 1.13), (& $P (-$k * 1.13) 0.565), (& $P (-$k * 1.13) -0.565) )
    $g.DrawPolygon((New-Object Drawing.Pen ([Drawing.Color]::FromArgb(40, 255, 236, 210)), ([single]($R * 0.10))), $halo)
    $g.FillPolygon((New-Object Drawing.SolidBrush $top), @($T, $UR, $C, $UL))
    $g.FillPolygon((New-Object Drawing.SolidBrush $left), @($UL, $C, $B, $LL))
    $g.FillPolygon((New-Object Drawing.SolidBrush $right), @($C, $UR, $LR, $B))
    $pen = New-Object Drawing.Pen $edge, ([single]($R * 0.075)); $pen.LineJoin = 'Round'
    $g.DrawPolygon($pen, @($T, $UR, $LR, $B, $LL, $UL))
    $g.DrawLine($pen, $C, $UL); $g.DrawLine($pen, $C, $UR); $g.DrawLine($pen, $C, $B)
    $g.Dispose()
    return $bmp
}

function Save-Png($bmp, [string]$file) {
    New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
    $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

# Android: dibujo del icono adaptativo (el cubo cabe en la zona segura de 66/108) e iconos clásicos.
$res = Join-Path $root 'android\app\src\main\res'
$densities = @{ mdpi = 1; hdpi = 1.5; xhdpi = 2; xxhdpi = 3; xxxhdpi = 4 }
foreach ($d in $densities.Keys) {
    $s = $densities[$d]
    Save-Png (New-Logo ([int](108 * $s)) 0.25 'none') "$res\mipmap-$d\ic_launcher_foreground.png"
    Save-Png (New-Logo ([int](48 * $s)) 0.30 'rounded') "$res\mipmap-$d\ic_launcher.png"
    Save-Png (New-Logo ([int](48 * $s)) 0.28 'circle') "$res\mipmap-$d\ic_launcher_round.png"
}

# Windows (instalador y ventana de la app) y web (PWA).
Save-Png (New-Logo 256 0.34 'rounded') (Join-Path $root 'build\icon.png')
Save-Png (New-Logo 256 0.34 'rounded') (Join-Path $root 'public\icon-256.png')

# icon.ico con varios tamaños (entradas PNG, formato válido desde Windows Vista).
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) { $ms = New-Object IO.MemoryStream; $b = New-Logo $s 0.34 'rounded'; $b.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); , $ms.ToArray() }
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
[IO.File]::WriteAllBytes((Join-Path $root 'build\icon.ico'), $ico.ToArray())
'Iconos generados.'
