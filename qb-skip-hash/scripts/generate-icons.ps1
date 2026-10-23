# Deterministic text icon, rendered at 4x resolution for clean small sizes.
Add-Type -AssemblyName System.Drawing
$iconDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\icons'))
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
foreach ($size in @(16, 32, 48, 128)) {
    $edge = $size * 4
    $bitmap = [System.Drawing.Bitmap]::new($edge, $edge)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $inset = $edge * 0.025
    $width = $edge - 2 * $inset
    $diameter = $edge * 0.36
    $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $shape.AddArc($inset, $inset, $diameter, $diameter, 180, 90)
    $shape.AddArc($inset + $width - $diameter, $inset, $diameter, $diameter, 270, 90)
    $shape.AddArc($inset + $width - $diameter, $inset + $width - $diameter, $diameter, $diameter, 0, 90)
    $shape.AddArc($inset, $inset + $width - $diameter, $diameter, $diameter, 90, 90)
    $shape.CloseFigure()
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#ea580c'))
    $graphics.FillPath($background, $shape)
    $font = [System.Drawing.Font]::new('Microsoft YaHei', [single]($edge * 0.74), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectangle = [System.Drawing.RectangleF]::new(0, -$edge * 0.025, $edge, $edge)
    $graphics.DrawString([string][char]0x8F85, $font, [System.Drawing.Brushes]::White, $rectangle, $format)
    $output = [System.Drawing.Bitmap]::new($size, $size)
    $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
    $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $outputGraphics.DrawImage($bitmap, 0, 0, $size, $size)
    $output.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $outputGraphics.Dispose(); $output.Dispose(); $format.Dispose(); $font.Dispose()
    $background.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
