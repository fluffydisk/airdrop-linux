from gi.repository import Gio, GLib
import re
import os
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
Gio.bus_own_name_on_connection(connection, 'org.freedesktop.portal.Desktop', Gio.BusNameOwnerFlags.NONE, lambda conn, name: print('READY', flush=True), None)
xml = '<node><interface name="org.freedesktop.portal.Background"><method name="RequestBackground"><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method></interface></node>'
info = Gio.DBusNodeInfo.new_for_xml(xml)
def method(conn, sender, obj, iface, name, params, invocation):
    _, options = params.unpack()
    request = '/org/freedesktop/portal/desktop/request/' + re.sub(r'[^A-Za-z0-9_]', '_', sender[1:]) + '/' + options['handle_token'] + '_returned'
    invocation.return_value(GLib.Variant('(o)', (request,)))
    def respond():
        conn.emit_signal(sender, request + '_unrelated', 'org.freedesktop.portal.Request', 'Response', GLib.Variant('(ua{sv})', (1, {'background': GLib.Variant('b', False)})))
        conn.emit_signal(sender, request, 'org.freedesktop.portal.Request', 'Response', GLib.Variant('(ua{sv})', (0 if os.environ.get('GRANT') == '1' else 1, {'background': GLib.Variant('b', os.environ.get('GRANT') == '1')})))
        return False
    GLib.timeout_add(50, respond)
connection.register_object('/org/freedesktop/portal/desktop', info.interfaces[0], method, None, None)
GLib.MainLoop().run()
