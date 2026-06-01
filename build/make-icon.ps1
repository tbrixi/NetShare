# Generates build/icon.ico - a flat network-topology glyph (three connected
# nodes on an accent-blue rounded-square background). Produces a multi-size
# .ico (16/24/32/48/64/128/256) so Windows can pick the right resolution for
# the taskbar, Alt-Tab, Explorer, and title bar. A single 256x256 PNG-only
# .ico is NOT enough - some Windows shell paths refuse to downscale it and
# fall back to a generic white icon. Re-run after editing the design.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-IconBitmap {
  param([int]$Size)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Scale every geometry constant by Size/256 so each rendering is crisp at
  # its native resolution instead of relying on post-downscale.
  $s = $Size / 256.0

  $accent  = [System.Drawing.Color]::FromArgb(255, 79, 140, 255)
  $bgBrush = New-Object System.Drawing.SolidBrush($accent)
  $inset   = 8 * $s
  $radius  = 48 * $s
  $rect    = New-Object System.Drawing.RectangleF($inset, $inset, ($Size - $inset * 2), ($Size - $inset * 2))
  $path    = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
  $path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
  $path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bgBrush, $path)

  $nodes = @(
    [pscustomobject]@{ X = 128 * $s; Y = 70  * $s },
    [pscustomobject]@{ X = 70  * $s; Y = 186 * $s },
    [pscustomobject]@{ X = 186 * $s; Y = 186 * $s }
  )
  $nodeRadius = 26 * $s
  $innerDotR  = 10 * $s
  $lineWidth  = [Math]::Max(2.0, 14 * $s)

  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $lineWidth)
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    for ($j = $i + 1; $j -lt $nodes.Count; $j++) {
      $g.DrawLine($linePen, $nodes[$i].X, $nodes[$i].Y, $nodes[$j].X, $nodes[$j].Y)
    }
  }

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

  $linePen.Dispose()
  $bgBrush.Dispose()
  $g.Dispose()
  return $bmp
}

function Get-PngBytes {
  param([System.Drawing.Bitmap]$Bitmap)
  $ms = New-Object System.IO.MemoryStream
  $Bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return ,$bytes
}

# Windows resolves the taskbar / Alt-Tab / title-bar icon by picking the entry
# whose size matches the requested pixel dimension. Include the common shell
# sizes so each pixel-perfect render is used instead of forcing a downscale.
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$images = @()
foreach ($sz in $sizes) {
  $bmp = New-IconBitmap -Size $sz
  $png = Get-PngBytes -Bitmap $bmp
  $bmp.Dispose()
  $images += [pscustomobject]@{ Size = $sz; Bytes = $png }
  Write-Output ("  rendered {0}x{0} ({1} bytes PNG)" -f $sz, $png.Length)
}

# Assemble multi-image ICONDIR:
#   header: reserved(2)=0, type(2)=1, count(2)=N
#   N x ICONDIRENTRY (16 bytes), data blocks back-to-back.
# All entries are PNG-encoded - supported by Windows Vista and later for any
# embedded size.
$out = New-Object System.IO.MemoryStream
$w   = New-Object System.IO.BinaryWriter($out)
$w.Write([uint16]0)
$w.Write([uint16]1)
$w.Write([uint16]$images.Count)

$dataOffset = 6 + (16 * $images.Count)
foreach ($img in $images) {
  $dim = if ($img.Size -ge 256) { [byte]0 } else { [byte]$img.Size }
  $w.Write([byte]$dim)             # width  (0 => 256)
  $w.Write([byte]$dim)             # height (0 => 256)
  $w.Write([byte]0)                # palette
  $w.Write([byte]0)                # reserved
  $w.Write([uint16]1)              # planes
  $w.Write([uint16]32)             # bits per pixel
  $w.Write([uint32]$img.Bytes.Length)
  $w.Write([uint32]$dataOffset)
  $dataOffset += $img.Bytes.Length
}
foreach ($img in $images) {
  $w.Write($img.Bytes)
}
$w.Flush()

$icoPath = Join-Path $PSScriptRoot 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$out.Dispose()
$total = (Get-Item $icoPath).Length
Write-Output ("Wrote {0} ({1} entries, {2} bytes total)" -f $icoPath, $images.Count, $total)
