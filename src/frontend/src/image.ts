import { blobToUrl } from "./common";

const MAX_IMG_SIZE = 16777216;

export const imageTooLarge = (image: HTMLImageElement) =>
    iOS() && image.height * image.width > MAX_IMG_SIZE;

export const imageHash = async (buffer: ArrayBuffer): Promise<string> => {
    const result = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(result)).slice(0, 4);
    return hashArray
        .map((bytes) => bytes.toString(16).padStart(2, "0"))
        .join("");
};

export const loadFile = (file: any): Promise<ArrayBuffer> => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onerror = () => {
            reader.abort();
            reject(alert("Couldn't upload file!"));
        };
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
    });
};

export const loadImage = (blob: ArrayBuffer): Promise<HTMLImageElement> => {
    const image = new Image();
    return new Promise((resolve) => {
        image.onload = () => resolve(image);
        image.src = blobToUrl(blob);
    });
};

/// Resizes the given image by the given scale.
export const rescaleImage = async (
    blob: ArrayBuffer,
    scale: number,
): Promise<ArrayBuffer> => {
    const image = await loadImage(blob);
    const canvas = drawOnCanvas(
        image,
        image.width * scale,
        image.height * scale,
    );
    return await canvasToBlob(canvas);
};

/// Resizes the given image such that it fits the given dimensions.
export const resizeImage = async (
    blob: ArrayBuffer,
    max_width: number,
    max_height: number,
): Promise<ArrayBuffer> => {
    const image = await loadImage(blob);
    const canvas = drawOnCanvas(image, max_width, max_height);
    return await canvasToBlob(canvas);
};

/// Extracts the image blob from the given canvas element.
const canvasToBlob = (canvas: HTMLCanvasElement): Promise<ArrayBuffer> =>
    new Promise((resolve) =>
        canvas.toBlob(
            (blob) => blob && blob.arrayBuffer().then(resolve),
            "image/jpeg",
            0.5,
        ),
    );

/// Draws the given image on a canvas element of the given maximum size by
/// resizing the image to fit the canvas and returns the canvas element.
const drawOnCanvas = (
    image: HTMLImageElement,
    max_width: number,
    max_height: number,
): HTMLCanvasElement => {
    let width = image.width;
    let height = image.height;
    // Take the maximum in order to make the largest dimention fit.
    let scale = Math.max(width / max_width, height / max_height, 1.0);
    width = width / scale;
    height = height / scale;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
    }
    return canvas;
};

const iOS = () =>
    [
        "iPad Simulator",
        "iPhone Simulator",
        "iPod Simulator",
        "iPad",
        "iPhone",
        "iPod",
    ].includes(navigator.platform);
