const Jimp = require('jimp');

async function resizeIcons() {
    try {
        const image = await Jimp.read('icons/icon128.png');

        const img48 = image.clone();
        img48.resize(48, 48);
        await img48.writeAsync('icons/icon48.png');

        const img16 = image.clone();
        img16.resize(16, 16);
        await img16.writeAsync('icons/icon16.png');

        console.log("SUCCESS");
    } catch (err) {
        console.error(err);
    }
}

resizeIcons();
