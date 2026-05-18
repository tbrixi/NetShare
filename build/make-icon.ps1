# Generates build/icon.ico — a flat network-topology glyph (three connected
# nodes on an accent-blue rounded-square background). Re-run this script after
# editing the design to regenerate the icon.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp  = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded-square background (app accent #4f8cff).
$accent = [System.Drawing.Color]::FromArgb(255, 79, 140, 255)
$bgBrush = New-Object System.Drawing.SolidBrush($accent)
$radius = 48
$rect = New-Object System.Drawing.Rectangle(8, 8, ($size - 16), ($size - 16))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
$path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
$path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()
$g.FillPath($bgBrush, $path)

# Three node positions (centres).
$nodes = @(
  [pscustomobject]@{ X = 128; Y = 70  },   # top
  [pscustomobject]@{ X = 70;  Y = 186 },   # bottom-left
  [pscustomobject]@{ X = 186; Y = 186 }    # bottom-right
)
$nodeRadius = 26

# Connecting lines drawn first so nodes sit on top.
$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 14)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
for ($i = 0; $i -lt $nodes.Count; $i++) {
  for ($j = $i + 1; $j -lt $nodes.Count; $j++) {
    $g.DrawLine($linePen, $nodes[$i].X, $nodes[$i].Y, $nodes[$j].X, $nodes[$j].Y)
  }
}

# Nodes — white fill, accent-blue inner dot for a "data" feel.
$innerDotR = 10
foreach ($n in $nodes) {
  $g.FillEllipse(
    [System.Drawing.Brushes]::White,
    ($n.X - $nodeRadius), ($n.Y - $nodeRadius),
    ($nodeRadius * 2), ($nodeRadius * 2))
  $g.FillEllipse(
    $bgBrush,
    ($n.X - $innerDotR), ($n.Y - $innerDotR),
    ($innerDotR * 2), ($innerDotR * 2))
}

$g.Dispose()

# Save the bitmap into a PNG byte stream, then wrap it in an ICO container.
# A single 256x256 PNG-in-ICO is what Windows expects for modern, scalable icons.
$pngStream = New-Object System.IO.MemoryStream
$bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$pngStream.Dispose()
$bmp.Dispose()

$out = New-Object System.IO.MemoryStream
$w   = New-Object System.IO.BinaryWriter($out)
$w.Write([uint16]0)               # reserved
$w.Write([uint16]1)               # type = icon
$w.Write([uint16]1)               # image count
# ICONDIRENTRY (16 bytes)
$w.Write([byte]0)                 # width  (0 => 256)
$w.Write([byte]0)                 # height (0 => 256)
$w.Write([byte]0)                 # palette
$w.Write([byte]0)                 # reserved
$w.Write([uint16]1)               # planes
$w.Write([uint16]32)              # bits per pixel
$w.Write([uint32]$pngBytes.Length)
$w.Write([uint32]22)              # data offset (6 header + 16 entry)
$w.Write($pngBytes)
$w.Flush()

$icoPath = Join-Path $PSScriptRoot 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$out.Dispose()
Write-Output "Wrote $icoPath ($($pngBytes.Length) byte PNG payload)"
