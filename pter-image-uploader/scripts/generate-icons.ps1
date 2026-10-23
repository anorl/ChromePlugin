Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
$fontFamily = [System.Drawing.FontFamily]::new('Microsoft YaHei')
$glyph = [System.Drawing.Drawing2D.GraphicsPath]::new()
$glyph.AddString([string][char]0x56FE, $fontFamily, [int][System.Drawing.FontStyle]::Bold, 96, [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericTypographic)
$bounds = $glyph.GetBounds()
$scale = 88 / [Math]::Max($bounds.Width, $bounds.Height)
$matrix = [System.Drawing.Drawing2D.Matrix]::new()
$matrix.Translate(-$bounds.X, -$bounds.Y)
$glyph.Transform($matrix)
$matrix.Reset()
$matrix.Scale($scale, $scale)
$glyph.Transform($matrix)
$bounds = $glyph.GetBounds()
$matrix.Reset()
$matrix.Translate((128 - $bounds.Width) / 2, (128 - $bounds.Height) / 2)
$glyph.Transform($matrix)
$background = [System.Drawing.Drawing2D.GraphicsPath]::new()
$background.AddArc(0, 0, 40, 40, 180, 90)
$background.AddArc(88, 0, 40, 40, 270, 90)
$background.AddArc(88, 88, 40, 40, 0, 90)
$background.AddArc(0, 88, 40, 40, 90, 90)
$background.CloseFigure()
$blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#2563eb'))
foreach ($size in @(16, 32, 48, 128)) {
    $canvas = [System.Drawing.Bitmap]::new($size * 4, $size * 4)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size / 32.0, $size / 32.0)
    $graphics.FillPath($blue, $background)
    $graphics.FillPath([System.Drawing.Brushes]::White, $glyph)
    $output = [System.Drawing.Bitmap]::new($size, $size)
    $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
    $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $outputGraphics.DrawImage($canvas, 0, 0, $size, $size)
    $output.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $outputGraphics.Dispose()
    $output.Dispose()
    $graphics.Dispose()
    $canvas.Dispose()
}
# Store the glyph as vector outlines so the SVG needs no installed font.
$points = $glyph.PathPoints
$types = $glyph.PathTypes
$commands = [System.Collections.Generic.List[string]]::new()
$culture = [System.Globalization.CultureInfo]::InvariantCulture
function Format-Point($point) {
    return $point.X.ToString('0.###', $culture) + ' ' + $point.Y.ToString('0.###', $culture)
}
for ($index = 0; $index -lt $points.Length; $index++) {
    $kind = $types[$index] -band 7
    if ($kind -eq 0) { $commands.Add('M' + (Format-Point $points[$index])) }
    elseif ($kind -eq 1) { $commands.Add('L' + (Format-Point $points[$index])) }
    elseif ($kind -eq 3) {
        $commands.Add('C' + (Format-Point $points[$index]) + ' ' + (Format-Point $points[$index + 1]) + ' ' + (Format-Point $points[$index + 2]))
        $index += 2
    }
    if ($types[$index] -band 128) { $commands.Add('Z') }
}
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="20" fill="#2563eb"/><path fill="white" fill-rule="evenodd" d="' + ($commands -join ' ') + '"/></svg>'
[System.IO.File]::WriteAllText((Join-Path $iconDirectory 'icon.svg'), $svg, [System.Text.UTF8Encoding]::new($false))
$blue.Dispose()
$background.Dispose()
$matrix.Dispose()
$glyph.Dispose()
$fontFamily.Dispose()
