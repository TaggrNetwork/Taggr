export const previewImg = (
    src: string,
    id: string,
    gallery: string[],
    urls: { [id: string]: string },
) => {
    const preview = document.getElementById("preview");
    if (!preview) return;
    while (preview.hasChildNodes()) {
        let firstChild = preview.firstChild;
        if (firstChild) preview.removeChild(firstChild);
    }
    preview.style.display = "flex";
    const pic = document.createElement("img");
    pic.src = src;
    pic.isMap = true;

    const notGallery = !gallery || gallery.length == 1;

    let slide = (next: boolean) => {
        if (notGallery) return;
        const pos = gallery.indexOf(id);
        if (pos < 0) return;
        const newId = gallery[mod(pos + (next ? 1 : -1), gallery.length)];
        id = newId;
        fadeInPicture(pic);
        let src = urls[newId];
        pic.src = src ? src : id;
    };

    pic.onclick = (event) => {
        const next = pic.clientWidth / 2 < event.offsetX;
        slide(next);
    };
    preview.appendChild(pic);
    pinchZoom(pic);
    fadeInPicture(pic);

    const closePreview = () => (preview.style.display = "none");

    document.onscroll = closePreview;
    preview.onclick = (event) => {
        let target: any = event.target;
        if (target?.id == "preview" || notGallery)
            preview.style.display = "none";
    };

    if (notGallery) return;

    const leftArrow = document.createElement("div");
    leftArrow.className = "button left_arrow";
    leftArrow.innerHTML = "&#8592;";
    leftArrow.onclick = () => slide(false);
    preview.appendChild(leftArrow);

    const rightArrow = document.createElement("div");
    rightArrow.className = "button right_arrow";
    rightArrow.innerHTML = "&#8594;";
    rightArrow.onclick = () => slide(true);
    preview.appendChild(rightArrow);

    const closeButton = document.createElement("div");
    closeButton.className = "button close";
    closeButton.innerHTML = "&#215;";
    closeButton.onclick = closePreview;
    preview.appendChild(closeButton);
};

// We need this becasue the native modulo function doesn't work on negative numbers as expected.
function mod(n: number, m: number) {
    return ((n % m) + m) % m;
}

// Source: https://apex.oracle.com/pls/apex/vmorneau/r/pinch-and-zoom/pinch-and-zoom-js
const pinchZoom = (imageElement: HTMLImageElement) => {
    let imageElementScale = 1;
    let currentTranslateX = 0;
    let currentTranslateY = 0;
    let isDragging = false;
    let dragStartTime = 0;

    let start: any = {};

    // Calculate distance between two fingers
    const distance = (event: any) => {
        return Math.hypot(
            event.touches[0].pageX - event.touches[1].pageX,
            event.touches[0].pageY - event.touches[1].pageY,
        );
    };

    // Apply transform with current values
    const applyTransform = () => {
        const transform = `translate3d(${currentTranslateX}px, ${currentTranslateY}px, 0) scale(${imageElementScale})`;
        imageElement.style.transform = transform;
        imageElement.style.webkitTransform = transform;
        imageElement.style.zIndex = imageElementScale > 1 ? "9999" : "";
    };

    imageElement.addEventListener("touchstart", (event: any) => {
        // Two finger pinch
        if (event.touches.length === 2) {
            event.preventDefault(); // Prevent page scroll
            // Calculate where the fingers have started on the X and Y axis
            start.x = (event.touches[0].pageX + event.touches[1].pageX) / 2;
            start.y = (event.touches[0].pageY + event.touches[1].pageY) / 2;
            start.distance = distance(event);
            start.scale = imageElementScale;
        }
        // One finger drag when zoomed
        else if (event.touches.length === 1 && imageElementScale > 1) {
            event.preventDefault();
            dragStartTime = Date.now();
            start.x = event.touches[0].pageX;
            start.y = event.touches[0].pageY;
            start.translateX = currentTranslateX;
            start.translateY = currentTranslateY;
        }
    });

    imageElement.addEventListener("touchmove", (event: any) => {
        if (event.touches.length === 2) {
            event.preventDefault(); // Prevent page scroll

            // Safari provides event.scale as two fingers move on the screen
            // For other browsers just calculate the scale manually
            let scale;
            if (event.scale) {
                scale = event.scale;
            } else {
                const deltaDistance = distance(event);
                scale = deltaDistance / start.distance;
            }
            imageElementScale = Math.min(Math.max(1, start.scale * scale), 4);

            // Calculate how much the fingers have moved on the X and Y axis
            const deltaX =
                (event.touches[0].pageX + event.touches[1].pageX) / 2 - start.x;
            const deltaY =
                (event.touches[0].pageY + event.touches[1].pageY) / 2 - start.y;

            currentTranslateX = deltaX * 2; // x2 for accelarated movement
            currentTranslateY = deltaY * 2; // x2 for accelarated movement

            // Transform the image to make it grow and move with fingers
            applyTransform();
        } else if (event.touches.length === 1 && imageElementScale > 1) {
            // One finger drag when zoomed
            event.preventDefault();
            isDragging = true;

            const deltaX = event.touches[0].pageX - start.x;
            const deltaY = event.touches[0].pageY - start.y;

            currentTranslateX = start.translateX + deltaX;
            currentTranslateY = start.translateY + deltaY;

            applyTransform();
        }
    });

    imageElement.addEventListener("touchend", (event: any) => {
        // Check if it was a quick tap (not a drag) and we're zoomed in
        if (event.touches.length === 0) {
            const touchDuration = Date.now() - dragStartTime;
            const wasQuickTap = touchDuration < 200 && !isDragging;

            if (wasQuickTap && imageElementScale > 1) {
                // Quick tap while zoomed - close preview
                const preview = document.getElementById("preview");
                if (preview) {
                    preview.style.display = "none";
                }
                return;
            }

            // Reset scale to 1 if it's very close (snap to normal size)
            if (imageElementScale < 1.1) {
                imageElementScale = 1;
                currentTranslateX = 0;
                currentTranslateY = 0;
                applyTransform();
            }
        }
        isDragging = false;
    });
};

const fadeInPicture = (pic: HTMLImageElement) => {
    pic.className = "fadein";
    setTimeout(() => (pic.className = ""), 150);
};
