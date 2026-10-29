"""Small bounded XTest adapter. Only fixed numeric pointer/query commands exist."""
import ctypes
import json
import sys


def emit(value):
    print(json.dumps(value), flush=True)


def main():
    x11 = ctypes.CDLL('libX11.so.6')
    xtst = ctypes.CDLL('libXtst.so.6')
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XQueryKeymap.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    xtst.XTestQueryExtension.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_int)] * 4
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError('unavailable')
    injected_buttons = set()
    try:
        values = [ctypes.c_int() for _ in range(4)]
        if not xtst.XTestQueryExtension(display, *[ctypes.byref(value) for value in values]):
            raise RuntimeError('unavailable')
        emit({'type': 'ready'})
        while True:
            line = sys.stdin.readline(257)
            if not line:
                break
            if len(line) > 256 or not line.endswith('\n'):
                raise RuntimeError('invalid')
            parts = line.split()
            request_id = int(parts[0])
            if len(parts) == 2 and parts[1] == 'released':
                held = ctypes.create_string_buffer(32)
                x11.XQueryKeymap(display, held)
                root, child = ctypes.c_ulong(), ctypes.c_ulong()
                rx, ry, wx, wy = [ctypes.c_int() for _ in range(4)]
                mask = ctypes.c_uint()
                x11.XQueryPointer(display, x11.XDefaultRootWindow(display), ctypes.byref(root), ctypes.byref(child), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask))
                emit({'type': 'result', 'id': request_id, 'ok': True, 'released': not any(held.raw) and not (mask.value & 0x1f00)})
            elif len(parts) == 6 and parts[1] == 'click':
                x, y, button, clicks = map(int, parts[2:])
                if not (-100000 <= x <= 100000 and -100000 <= y <= 100000 and button in (1, 2, 3) and clicks in (1, 2)):
                    raise RuntimeError('invalid')
                if not (0 <= x < x11.XDisplayWidth(display, 0) and 0 <= y < x11.XDisplayHeight(display, 0)):
                    emit({'type': 'result', 'id': request_id, 'ok': False, 'code': 'MACRO_COORDINATES'})
                    continue
                if not xtst.XTestFakeMotionEvent(display, -1, x, y, 0):
                    raise RuntimeError('unavailable')
                for _ in range(clicks):
                    if not xtst.XTestFakeButtonEvent(display, button, 1, 0):
                        raise RuntimeError('unavailable')
                    injected_buttons.add(button)
                    if not xtst.XTestFakeButtonEvent(display, button, 0, 0):
                        raise RuntimeError('unavailable')
                    injected_buttons.discard(button)
                x11.XSync(display, 0)
                emit({'type': 'result', 'id': request_id, 'ok': True})
            else:
                raise RuntimeError('invalid')
    finally:
        for button in injected_buttons:
            xtst.XTestFakeButtonEvent(display, button, 0, 0)
        x11.XSync(display, 0)
        x11.XCloseDisplay(display)


try:
    main()
except Exception:
    emit({'type': 'error', 'code': 'MACRO_UNAVAILABLE'})
    sys.exit(1)
