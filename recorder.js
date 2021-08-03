let audioCtx;
let audioDest;
let recorder;

window.addEventListener('message', event => {
    if (event && event.data) {
        switch (event.data.type) {
            case 'recorder_start':
                startRecording();
                break;
            case 'recorder_stop':
                stopRecording();
                break;
        }
    }
});
window.parent.postMessage({ type: 'recorder_ready' }, '*');

function clrCtx() {
    recorder = null;
    audioCtx = null;
    audioDest = null;
    if (APP.conference._room) {
        APP.conference._room.off(JitsiMeetJS.events.conference.TRACK_ADDED, trackAddedHandler);
    }
}

function errorHandler(e) {
    console.error(e);
    window.parent.postMessage({ type: 'recorder_error' }, '*');
}

function trackAddedHandler(track) {
    if (audioCtx && audioDest && track.getType() === 'audio') {
        audioCtx.createMediaStreamSource(track.stream).connect(audioDest);
    }
}

async function startRecording() {
    try {
        const recordingData = [];
        audioCtx = new AudioContext();
        audioDest = audioCtx.createMediaStreamDestination();

        const videoTrack = (await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        })).getVideoTracks()[0];
        videoTrack.addEventListener('ended', () => {
            window.parent.postMessage({ type: 'recorder_stop' }, '*');
            stopRecording();
        });
        audioDest.stream.addTrack(videoTrack);

        APP.conference._room.on(JitsiMeetJS.events.conference.TRACK_ADDED, trackAddedHandler);
        audioCtx.createMediaElementSource(new Audio(createSilentAudio(1))).connect(audioDest);
        if (APP.conference.localAudio) {
            audioCtx.createMediaStreamSource(APP.conference.localAudio.stream).connect(audioDest);
        }
        for (let participant of APP.conference._room.getParticipants()) {
            for (let track of participant.getTracksByMediaType('audio')) {
                audioCtx.createMediaStreamSource(track.stream).connect(audioDest);
            }
        }

        recorder = new MediaRecorder(audioDest.stream);
        recorder.onerror = e => {
            throw e;
        };
        recorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                recordingData.push(e.data);
            }
        };
        recorder.onstop = () => {
            videoTrack.stop();
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(new Blob(recordingData, { type: 'video/mp4' }));
            a.download = APP.conference._room.getMeetingUniqueId();
            a.click();
        };
        recorder.start();
    } catch (e) {
        errorHandler(e);
        clrCtx();
    }
}

function stopRecording() {
    try {
        if (recorder) {
            recorder.stop();
        }
    } catch (e) {
        errorHandler(e);
    }
    clrCtx();
}

function createSilentAudio(time, freq = 44100) {
    const audioFile = new AudioContext().createBuffer(1, time * freq, freq);
    let numOfChan = audioFile.numberOfChannels,
        len = time * freq * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(len),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    setUint32(0x46464952);
    setUint32(len - 8);
    setUint32(0x45564157);

    setUint32(0x20746d66);
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(audioFile.sampleRate);
    setUint32(audioFile.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164);
    setUint32(len - pos - 4);

    for (i = 0; i < audioFile.numberOfChannels; i++) {
        channels.push(audioFile.getChannelData(i));
    }

    while (pos < len) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}