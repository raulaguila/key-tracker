"""Pure helper regression proof; it neither opens D-Bus nor injects OS input."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("dobra_wayland_macro", Path(__file__).resolve().parents[1] / "app/macro-input/wayland.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def rejects(code, call):
    try:
        call()
    except module.PortalError as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError("Expected " + code)


monitors = module.parse_geometry([(50, {"position": (-1280, 0), "size": (1280, 720), "source_type": 1}), (51, {"position": (0, 0), "size": (1920, 1080)})])
assert module.locate(monitors, -1, 719) == (50, 1279.0, 719.0)
assert module.locate(monitors, 0, 0) == (51, 0.0, 0.0)
rejects("coordinates", lambda: module.locate(monitors, -1281, 0))
rejects("coordinates", lambda: module.locate(monitors, 1920, 0))

for streams in [[], [(1, {"size": (1, 1)})], [(1, {"position": (0, 0), "size": (0, 1)})], [(1, {"position": (0, 0), "size": (1, 1), "source_type": 2})], [(True, {"position": (0, 0), "size": (1, 1)})]]:
    rejects("geometry-missing", lambda: module.parse_geometry(streams))

assert module.parse_key("Control+Shift+A") == [0xFFE3, 0xFFE1, ord("a")]
assert module.parse_key("NumpadEnter") == [0xFF8D]
assert module.parse_key("F24") == [0xFFD5]
for key in ["exec:rm", "Control+Control+A", "A+B", "Control+á", "Control+", "Shift"]:
    rejects("protocol", lambda: module.parse_key(key))


class FakeGLib:
    class Error(Exception):
        pass


class InputPortal(module.DesktopPortal):
    def __init__(self, failure_at=None):
        super().__init__(None, FakeGLib)
        self.ready = True
        self.session = "/test"
        self.monitors = monitors
        self.events = []
        self.failure_at = failure_at

    def notify(self, method, signature, *arguments):
        self.events.append((method, arguments))
        if len(self.events) == self.failure_at:
            raise FakeGLib.Error("private error")


portal = InputPortal()
portal.key({"key": "Control+V"})
assert portal.events == [("NotifyKeyboardKeysym", (0xFFE3, 1)), ("NotifyKeyboardKeysym", (ord("v"), 1)), ("NotifyKeyboardKeysym", (ord("v"), 0)), ("NotifyKeyboardKeysym", (0xFFE3, 0))]
assert portal.keys_down == []

portal = InputPortal(failure_at=2)
try:
    portal.key({"key": "Control+V"})
except FakeGLib.Error:
    pass
else:
    raise AssertionError("Press failure must propagate")
assert portal.events[-2:] == [("NotifyKeyboardKeysym", (ord("v"), 0)), ("NotifyKeyboardKeysym", (0xFFE3, 0))]
assert portal.keys_down == []

portal = InputPortal()
portal.click({"x": -500, "y": 250, "button": "right", "clicks": 2})
assert portal.events[0] == ("NotifyPointerMotionAbsolute", (50, 780.0, 250.0))
assert portal.events[1:] == [("NotifyPointerButton", (0x111, 1)), ("NotifyPointerButton", (0x111, 0)), ("NotifyPointerButton", (0x111, 1)), ("NotifyPointerButton", (0x111, 0))]
assert portal.buttons_down == []

portal = InputPortal(failure_at=2)
try:
    portal.click({"x": 100, "y": 100, "button": "left", "clicks": 1})
except FakeGLib.Error:
    pass
else:
    raise AssertionError("Click failure must propagate")
assert portal.events[-1] == ("NotifyPointerButton", (0x110, 0))
assert portal.buttons_down == []

print("8 checks passed")
