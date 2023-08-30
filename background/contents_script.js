//simple function to open the user interface
// chrome.browserAction.onClicked.addListener(function () {
//     //then we open our user interface tab
//     chrome.tabs.create({ url: 'index.html' }, function (tab) {
//         //this then returns a tab, from which we need to keep track of the tab id
//         let recordReplayTabId = tab.id;
//         //then we need to activate our background process observables, we stay dormant with no user interface
//         var MessageListener = new MessageMonitor().initialise();
//         //then we need to add a listener for our user interface closing
//         chrome.tabs.onRemoved.addListener(function (tabId) {
//             //then if the tab id matches the record replay id, we just run our background shutdown processes
//             if (tabId == recordReplayTabId) {
//                 //at the moment all our actions in the background process is started by the message listener so shutting it down should render it inactive
//                 MessageListener.shutdown();
//             }
//         });
//     });
// });

// chrome.runtime.onMessageExternal.addListener(function (request, sender, sendResponse) {
//     if (request.sayHello) {
//         console.log(sender);
//         console.log(request.sayHello);
//         sendResponse({ sayHelloBack: 'Greetings From Extension' });
//     }
//     if (request.command) {
//         switch (request.command) {
//             case 'LoadAllProjects':
//                 StorageUtils.getAllObjectsInDatabaseTable('External WebSite', 'projects').then((projects) =>
//                     sendResponse({ projects: projects })
//                 );
//                 return true;
//             case 'LoadAllTests':
//                 StorageUtils.getAllObjectsInDatabaseTable('External WebSite', 'tests').then((tests) =>
//                     sendResponse({ tests: tests })
//                 );
//                 return true;
//             case 'LoadAllReplays':
//                 StorageUtils.getAllObjectsInDatabaseTable('External WebSite', 'replays').then((replays) =>
//                     sendResponse({ replays: replays })
//                 );
//                 return true;
//             default:
//                 console.log(`Unrecognised Command From External ${request.command}`);
//         }
//     }
// });

//FOR TESTING
/*
let activeTab = 0;

chrome.tabs.create({ url: 'https://test.infkuba.ch/staging/' }, (tab) => {
    activeTab = tab.id;
    console.log(tab);
    setTimeout(() => executeScriptInMainFrame(tab.id, 'console.log("fanny waggle");'), 2000);
});
*/

function addStartRecordingHandlerLocal(newRecordingObject) {
    //RECORDING EVENTS START HANDLER
    const recordingEventObservable = Rx.Observable.fromEvent(
        document.querySelector('#article > .buttons > .record-button'),
        'click'
    )
        //make the changes to the ui to indicate that we have started
        .do((event) => {
            console.log("----------------");
            console.log(event);
            console.log("----------------");
        })
        //map the event to the recording that has started by querying storage using the data id from the button
        .flatMap((event) => {
            return new Promise(resolve => {
                resolve(newRecordingObject)
            })
        })
        //we need to instruct background script to start the tab with the recording
        .switchMap(
            (recording) =>
                {
                    console.log("============eevvvee=============")
                    console.log(recording)
                    console.log("============eevvvee=============")
                    
                    //in the background scripts, there is some time required to set up the active recording and the tab runner
                    //we do not want to start processing events until this happens so we send the message and wait for the response
                    return Rx.Observable.fromPromise(
                        new RecordReplayMessenger({}).sendMessageGetResponse({ newRecording: recording })
                    )
                },
            //if we have an error in the initial setup, for example with debugger failing to attach, then this will be reported here
            (readyStateRecording, response) => {
                console.log("============eevvvee=============")
                console.log(response)
                console.log(readyStateRecording)
                console.log("============eevvvee=============")
                if (response.message.includes('Cannot attach to this target')) {
                    //change the UI
                    //hide the replay loader
                    $('.ui.text.small.recording.loader').removeClass('active');
                    //then alert the user to this fatal error
                    alert( 
                        `Chrome Remote Debugging: ${response.message}\nhttps://bugs.chromium.org/p/chromium/issues/detail?id=885025`
                    );
                    readyStateRecording.terminated = true;
                } else {
                    readyStateRecording.terminated = false;
                }
                return readyStateRecording;
            }
        )
        //then we filter in only the ones we want to keep
        .filter((x) => x.terminated === false)
        //then we create a recording messenger that updates its active recording each time there is a message emitted
        .switchMap(
            () =>
                //then we need to start receiving recording events sent here by the content script, originating in either main frame or iframe content scripts
                new RecordReplayMessenger({})
                    .isAsync(false)
                    .chromeOnMessageObservable //we only want to receive recording events here
                    .filter((msgObject) => msgObject.request.hasOwnProperty('recordingEvent'))
                    //then we need to send a response to the location that sent out the event
                    .do((msgObject) =>
                        msgObject.sendResponse({
                            message: `User Interface Received Recording Event: ${msgObject.request.recordingEvent.recordingEventId}`,
                        })
                    )
                    //we only care about the recording events at the moment so we can just map to those
                    .map((msgObject) => msgObject.request.recordingEvent)
                    //and we need to start with a dummy marker so we can operate with only one emission, this must come before pairwise() to create the first pair
                    .startWith(new RecordingEvent({ recordingEventOrigin: 'PairwiseStart' }))
                    //then we need to get the time between each emission so we take two emissions at a time
                    .pairwise()
                    //this then delivers an array with the previous and the current, we only need the current, with adjusted recordingTimeSincePrevious
                    .map(([previousRecording, currentRecording]) => {
                        //if the previous was not the dummy 'PairwiseStart', then we need to add the relative time of the recording event so we can exactly reproduce timing steps with delays
                        //if it is then the time will be 0, with zero delay, which is what we want
                        //this can be actioned in the replay mode via .concatMap(event => Rx.Observable.of(event).delay(event.recordingTimeSincePrevious))
                        previousRecording.recordingEventOrigin != 'PairwiseStart'
                            ? (currentRecording.recordingTimeSincePrevious =
                                  currentRecording.recordingEventCreated - previousRecording.recordingEventCreated)
                            : null;
                        //then we just need to return the current recording as we don't care about the dummy or the previous
                        return currentRecording;
                    }),
            //then use the projection function to tie the two together
            (recording, recordingEvent) => {
                //push the new recording event into the recording's event array
                recording.recordingEventArray.push(recordingEvent);
                //then return the recording so it can be updated in the database
                return recording;
            }
        );

    //DELETION EVENTS
    // const deletionEventObservable = Rx.Observable.fromEvent(document, 'cakflick')
    //     //we only care about elements that match our delete button class
    //     .filter((event) => event.target.classList.contains('deleteRecordingEventRow'))
    //     //then just to be sure we need them to have a data recording event id
    //     .filter((event) => event.target.hasAttribute('data-recording-event-id'))
    //     //then we map all those clicks into their recording event ids
    //     .map((event) => event.target.getAttribute('data-recording-event-id'))
    //     //then we need to start with a dummy string so we get an emission
    //     .startWith('DELETED RECORDING EVENT IDS FOLLOW')
    //     //then we scan them all into an array
    //     .scan((acc, value) => {
    //         acc.push(value);
    //         return acc;
    //     }, []);

    //THEN WE NEED TO COMBINE THE TWO SO WE GET THE EVENTS COMING FROM THE CURATED TAB AND OUR LIVE DELETION EVENTS
    Rx.Observable.combineLatest(
        //each of the recording events pumps out a new recording
        recordingEventObservable,
        //each of the deletion events pumps out a new set of deleted recording event ids
        // deletionEventObservable,
        // combineLatest also takes an optional projection function
        (recording, deletedEventsIdArray) => {
            //we need to save the recording's id as that will be lost on creation of the temporary class
            let carriedForwardId = recording.id;
            //then we create a temporary recording so we can use the class method to redo time since previous
            let tempRecording = new Recording(recording);
            //then we loop through all the elements of the array - it does not matter if they've been done before
            for (let recordingEventId in deletedEventsIdArray) {
                //then pick each of the deleted events from the recording's events array
                tempRecording.deleteRecordingEventById(deletedEventsIdArray[recordingEventId]);
            }
            //then add the recording id back
            tempRecording.id = carriedForwardId;
            //then return the amended recording, if there have been any live deletions
            return tempRecording;
        }
    )
        //we only want to make additions until the user interface stop recording button is clicked
        .takeUntil(
            //merge the two sources of potential recording stop commands, either will do
            Rx.Observable.merge(
                //obviously the stop button is a source of finalisation
                // Rx.Observable.fromEvent(document.querySelector('.ui.stopRecording.negative.button'), 'click')
                //     //we need to send the message to the background script here
                //     .do((event) =>
                //         new RecordReplayMessenger({}).sendMessage({
                //             stopNewRecording: event.target.getAttribute('data-recording-id'),
                //         })
                //     ),
                //less obviously, the user might choose to stop the recording by closing the tab window
                //background scripts keep an eye on this and will send a message entitled recordingTabClosed
                new RecordReplayMessenger({})
                    .isAsync(false)
                    .chromeOnMessageObservable //we only want to receive recordingTabClosed events here
                    .filter((msgObject) => msgObject.request.hasOwnProperty('recordingTabClosed'))
                    //send the response so we don't get the silly errors
                    .do((msgObject) => msgObject.sendResponse({ message: `User Interface Received Tab Closed Event` }))
            )
        )
        //change the user interface
        .subscribe(
            //when we get each mutated recording emitted, we need to update the recording in the database with its new recording event array
            (recording) => {
                //log to the console so we can follow what's going on
                console.log("-------- in subscribe -----------")
                console.log(recording);
                console.log("-------- // in subscribe -----------")
                //add the recording event to the table
                // updateNewRecordingEventsTable(recording);
                //then add the button listeners
                // addNewRecordingEventButtonListeners();
                //then update the recording in the database
                // StorageUtils.updateModelObjectInDatabaseTable('recordings.js', recording.id, recording, 'recordings');
            },
            (error) => console.error(error),
            //when complete we want to update the UI
            () => {
                //hide the recording loader
                // $('.ui.text.small.recording.loader').removeClass('active');
                //then we need to add the start recording handler again
                addStartRecordingHandlerLocal(newRecordingObject);
            }
        );
}

const init = () => {    
    const article = document.querySelector('#article > .buttons');
    console.log(article);
    if (article) {
        const button = document.createElement('button');
        button.classList.add('record-button');
        button.textContent="녹화 on";
        button.onclick=() => {
            
        }
        article.appendChild(button);
        // chrome.runtime.sendMessage({type: "record"}).then(() => {
        //     readyStart();
        // });
        readyStart();
    }
}

const observeUrlChange = () => {
  let oldHref = document.location.href;
  const body = document.querySelector("body");
  const observer = new MutationObserver(mutations => {
    if (oldHref !== document.location.href) {
      oldHref = document.location.href;
      /* Changed ! your code here */
      console.log('in changed');
      init();
    }
  });
  observer.observe(body, { childList: true, subtree: true });
};

const readyStart = () => {
    // create new record
    const newRecording = new Recording({
        //displayed fields from form
        recordingName: `record${new Date().getTime()}`,
        recordingDescription: 'N/A',
        recordingAuthor: 'N/A',
        recordingIsMobile: false,
        recordingMobileOrientation: "portrait",
        recordingMobileDeviceId: 0,
        recordingTestStartUrl: "https://universe-qa.hyundaicard.com/demo/home",
        //inherited defaults from storage table queried by string recordingTestId selection drop down
        recordingProjectId: 1,
        recordingProjectName: "testProjectName",
        recordingTestId: 1,
        recordingTestName: "testName",
        recordingTestBandwidthValue: 187500,
        recordingTestBandwidthName: "1.5 Mbps",
        recordingTestLatencyValue: 0,
        recordingTestLatencyName: "None",
        recordingTestPerformanceTimings: false,
        recordingTestResourceLoads: false,
        recordingTestScreenshot: true,
        recordingTestVisualRegression: false,
    });
    console.log("in recorad start")
    // start new record
    addStartRecordingHandlerLocal(newRecording);
    // $('#article > .buttons > .record-button').trigger('click')
}

window.addEventListener('load', function(){
  //실행될 코드
  console.log('on load')
  console.log(MessageMonitor);
  const messageMonitor = new MessageMonitor();
  messageMonitor.initialise();
  observeUrlChange()
});
