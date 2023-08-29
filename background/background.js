console.log('init background0');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background got a message!", message);
    switch (message.type) {
        case 'record':
            // recordStart();
            console.log('record')
            console.log(recordStart);
            sendResponse({
                type: 'go',
            })
            break;
        default:
            break;
    }
});
