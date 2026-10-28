#!/usr/bin/env python3
"""Real D-Bus transport with a controlled Flatpak portal; not a real update."""
import subprocess,sys,threading
import gi
gi.require_version('Gio','2.0')
from gi.repository import Gio,GLib
bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
loop=GLib.MainLoop();terminal=2
xml='''<node><interface name="org.freedesktop.portal.Flatpak"><method name="CreateUpdateMonitor"><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method></interface><interface name="org.freedesktop.portal.Flatpak.UpdateMonitor"><method name="Update"><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method></interface></node>'''
path='/org/freedesktop/portal/Flatpak/update_monitor/test'
def method(connection,sender,object_path,interface,name,parameters,invocation):
 if name=='CreateUpdateMonitor':
  assert parameters.unpack()==({},)
  invocation.return_value(GLib.Variant('(o)',(path,)))
 else:
  assert parameters.unpack()==('',{})
  invocation.return_value(GLib.Variant('()',()))
  def reply():
   for status in [0,terminal]:
    connection.emit_signal(sender,path,'org.freedesktop.portal.Flatpak.UpdateMonitor','Progress',GLib.Variant('(a{sv})',({'status':GLib.Variant('u',status),'progress':GLib.Variant('u',42)},)))
   return False
  GLib.timeout_add(50,reply)
info=Gio.DBusNodeInfo.new_for_xml(xml)
regs=[bus.register_object('/org/freedesktop/portal/Flatpak',info.interfaces[0],method,None,None),bus.register_object(path,info.interfaces[1],method,None,None)]
owner=Gio.bus_own_name_on_connection(bus,'org.freedesktop.portal.Flatpak',Gio.BusNameOwnerFlags.NONE,None,None)
thread=threading.Thread(target=loop.run,daemon=True);thread.start()
try:
 for terminal,expected in [(2,'done'),(1,'empty'),(3,None)]:
  result=subprocess.run([sys.argv[1]],capture_output=True,text=True,timeout=10)
  assert 'progress 42' in result.stdout
  if expected:assert result.returncode==0 and expected in result.stdout
  else:assert result.returncode!=0 and 'done' not in result.stdout
 print('PASS: official CreateUpdateMonitor/Update methods, directed progress, done, empty and failure over real D-Bus (controlled service; not an installed update)')
finally:
 loop.quit();thread.join(timeout=3);Gio.bus_unown_name(owner)
 for reg in regs:bus.unregister_object(reg)
