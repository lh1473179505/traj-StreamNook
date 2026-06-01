// Tiny module-level flag the settings recorder sets while it is capturing keys.
// The global dispatcher checks this and stands down so recording a new chord
// (even one that collides with an existing bind) never also fires the action.

let recording = false;

export function setRecordingKeybind(value: boolean): void {
  recording = value;
}

export function isRecordingKeybind(): boolean {
  return recording;
}
