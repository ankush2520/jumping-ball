const WATERMARK_SRC = "/images/bounce-watermark.jpg";

let watermarkImage: HTMLImageElement | null = null;

const getWatermarkImage = () => {
  if (typeof window === "undefined") return null;

  if (!watermarkImage) {
    watermarkImage = new Image();
    watermarkImage.decoding = "async";
    watermarkImage.src = WATERMARK_SRC;
  }

  return watermarkImage;
};

export const drawCanvasWatermark = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  const image = getWatermarkImage();

  if (!image?.complete || image.naturalWidth === 0) return;

  const isMobile = width < 600;
  const baseWidth = isMobile
    ? width * 0.36
    : Math.min(Math.max(width * 0.22, 140), Math.min(width * 0.24, 320));
  const targetWidth = baseWidth * 0.2;
  const targetHeight = targetWidth * (image.naturalHeight / image.naturalWidth);
  const x = (width - targetWidth) / 2;
  const y = (height - targetHeight) / 2;

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.drawImage(image, x, y, targetWidth, targetHeight);
  ctx.restore();
};
