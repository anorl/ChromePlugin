$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
[IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
$family = [Drawing.FontFamily]::new('Microsoft YaHei')
$glyph = [Drawing.Drawing2D.GraphicsPath]::new()
$glyph.AddString([string][char]0x8C22, $family, [int][Drawing.FontStyle]::Bold, 96, [Drawing.PointF]::new(0, 0), [Drawing.StringFormat]::GenericTypographic)
$bounds = $glyph.GetBounds()
$matrix = [Drawing.Drawing2D.Matrix]::new()
$matrix.Translate(-$bounds.X, -$bounds.Y)
$glyph.Transform($matrix)
$matrix.Reset()
$scale = 104 / [Math]::Max($bounds.Width, $bounds.Height)
$matrix.Scale($scale, $scale)
$glyph.Transform($matrix)
$bounds = $glyph.GetBounds()
$matrix.Reset()
$matrix.Translate((128 - $bounds.Width) / 2, (128 - $bounds.Height) / 2)
$glyph.Transform($matrix)
foreach ($size in @(16, 32, 48, 128)) {
    $canvas = [Drawing.Bitmap]::new($size * 4, $size * 4)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([Drawing.Color]::FromArgb(28, 94, 175))
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size * 4 / 128), ($size * 4 / 128))
    $graphics.FillPath([Drawing.Brushes]::White, $glyph)
    $result = [Drawing.Bitmap]::new($size, $size)
    $output = [Drawing.Graphics]::FromImage($result)
    $output.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $output.DrawImage($canvas, 0, 0, $size, $size)
    $result.Save((Join-Path $iconDirectory "$size.png"), [Drawing.Imaging.ImageFormat]::Png)
    $output.Dispose(); $result.Dispose(); $graphics.Dispose(); $canvas.Dispose()
}
$matrix.Dispose(); $glyph.Dispose(); $family.Dispose()
