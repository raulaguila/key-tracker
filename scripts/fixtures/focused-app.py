"""Create a bounded foreground-app fixture on an owned, local Xvfb display.

Usage (use the DISPLAY of the isolated Electron QA instance):
  DOBRA_CONTEXT_FIXTURE=1 DISPLAY=:99 python3 scripts/fixtures/focused-app.py --duration 30

Prints readiness as one JSON line. Restores _NET_ACTIVE_WINDOW on shutdown if it
still points to this fixture. Never connects to a user's ordinary desktop.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import signal
import sys
import time


def owned_xvfb_display():
    display = os.environ.get('DISPLAY', '').split('.')[0]
    if not display.startswith(':') or os.environ.get('DOBRA_CONTEXT_FIXTURE') != '1':
        return False
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            args = process.joinpath('cmdline').read_bytes().split(b'\0')
            if Path(os.fsdecode(args[0])).name == 'Xvfb' and display.encode() in args:
                return True
        except (OSError, ValueError):
            continue
    return False


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--duration', type=int, default=30, choices=range(1, 61), metavar='1..60')
parser.add_argument('--name', default='ContextProof')
arguments = parser.parse_args()
if not owned_xvfb_display():
    raise SystemExit('Refused: provide DOBRA_CONTEXT_FIXTURE=1 and an owned local Xvfb DISPLAY.')
if not arguments.name or len(arguments.name) > 120 or any(ord(character) < 32 for character in arguments.name):
    raise SystemExit('Invalid fixture name.')

x = ctypes.CDLL('libX11.so.6')
display_type = ctypes.c_void_p
window_type = ctypes.c_ulong
atom_type = ctypes.c_ulong
x.XOpenDisplay.restype = display_type
x.XDefaultRootWindow.argtypes = [display_type]
x.XDefaultRootWindow.restype = window_type
x.XCreateSimpleWindow.argtypes = [display_type, window_type, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_ulong]
x.XCreateSimpleWindow.restype = window_type
x.XInternAtom.argtypes = [display_type, ctypes.c_char_p, ctypes.c_int]
x.XInternAtom.restype = atom_type
x.XChangeProperty.argtypes = [display_type, window_type, atom_type, atom_type, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
x.XGetWindowProperty.argtypes = [display_type, window_type, atom_type, ctypes.c_long, ctypes.c_long, ctypes.c_int, atom_type, ctypes.POINTER(atom_type), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
x.XMapWindow.argtypes = [display_type, window_type]
x.XDestroyWindow.argtypes = [display_type, window_type]
x.XDeleteProperty.argtypes = [display_type, window_type, atom_type]
x.XFlush.argtypes = [display_type]
x.XCloseDisplay.argtypes = [display_type]
x.XFree.argtypes = [ctypes.c_void_p]
x.XStoreName.argtypes = [display_type, window_type, ctypes.c_char_p]


class Hint(ctypes.Structure):
    _fields_ = [('res_name', ctypes.c_char_p), ('res_class', ctypes.c_char_p)]


x.XSetClassHint.argtypes = [display_type, window_type, ctypes.POINTER(Hint)]
display = x.XOpenDisplay(None)
if not display:
    raise SystemExit('Could not open the isolated Xvfb display.')
root = x.XDefaultRootWindow(display)
active_atom = x.XInternAtom(display, b'_NET_ACTIVE_WINDOW', 0)

def active_window():
    actual_type = atom_type()
    actual_format = ctypes.c_int()
    count = ctypes.c_ulong()
    remaining = ctypes.c_ulong()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    x.XGetWindowProperty(display, root, active_atom, 0, 1, 0, 33, ctypes.byref(actual_type), ctypes.byref(actual_format), ctypes.byref(count), ctypes.byref(remaining), ctypes.byref(data))
    try:
        return ctypes.cast(data, ctypes.POINTER(window_type))[0] if count.value and data else None
    finally:
        if data:
            x.XFree(data)


previous = active_window()
window = x.XCreateSimpleWindow(display, root, 0, 0, 180, 100, 0, 0, 0)
name = arguments.name.encode('utf-8')
x.XSetClassHint(display, window, ctypes.byref(Hint(b'context-proof', name)))
x.XStoreName(display, window, b'SHOULD_NOT_CROSS_BOUNDARY')
pid = ctypes.c_ulong(os.getpid())
window_value = window_type(window)
x.XChangeProperty(display, window, x.XInternAtom(display, b'_NET_WM_PID', 0), 6, 32, 0, ctypes.byref(pid), 1)
x.XChangeProperty(display, root, active_atom, 33, 32, 0, ctypes.byref(window_value), 1)
x.XMapWindow(display, window)
x.XFlush(display)
print(json.dumps({'pid': os.getpid(), 'name': arguments.name, 'windowId': window, 'executable': os.path.realpath(sys.executable)}), flush=True)

stopped = False


def stop(signum, frame):
    global stopped
    stopped = True


for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(signum, stop)
try:
    deadline = time.monotonic() + arguments.duration
    while not stopped and time.monotonic() < deadline:
        time.sleep(0.1)
finally:
    if active_window() == window:
        if previous is None:
            x.XDeleteProperty(display, root, active_atom)
        else:
            previous_value = window_type(previous)
            x.XChangeProperty(display, root, active_atom, 33, 32, 0, ctypes.byref(previous_value), 1)
    x.XDestroyWindow(display, window)
    x.XFlush(display)
    x.XCloseDisplay(display)
