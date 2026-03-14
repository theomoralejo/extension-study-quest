const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, 'icons', 'fav.svg');

async function processIcons() {
    try {
        await sharp(svgPath).resize(16, 16).png().toFile(path.join(__dirname, 'icons', 'icon16.png'));
        await sharp(svgPath).resize(48, 48).png().toFile(path.join(__dirname, 'icons', 'icon48.png'));
        await sharp(svgPath).resize(128, 128).png().toFile(path.join(__dirname, 'icons', 'icon128.png'));
        console.log("SVG converted successfully to PNGs.");
    } catch (e) {
        console.error("Error converting SVG:", e);
    }
}

processIcons();
