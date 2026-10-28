/* SPDX-License-Identifier: MIT
 * The Flatpak portal updates only the calling app using its existing origin.
 * No host execution, extra permissions or signature bypass is used.
 */
#include <gio/gio.h>
#include <stdio.h>
static GMainLoop *loop;
static int result = 1;
static void progress(GDBusConnection *bus,const gchar *sender,const gchar *path,
                     const gchar *interface,const gchar *signal,GVariant *parameters,gpointer unused) {
  (void)bus;(void)sender;(void)path;(void)interface;(void)signal;(void)unused;
  GVariant *info;guint32 status=0,percent=0;
  g_variant_get(parameters,"(@a{sv})",&info);
  g_variant_lookup(info,"status","u",&status);
  g_variant_lookup(info,"progress","u",&percent);
  if(status==1){g_print("empty\n");result=0;}
  else if(status==2){g_print("done\n");result=0;}
  else if(status==3)g_printerr("Update failed or was cancelled\n");
  else g_print("progress %u\n",MIN(percent,100));
  fflush(stdout);g_variant_unref(info);
  if(status)g_main_loop_quit(loop);
}
int main(void) {
  GError *error=NULL;
  GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);
  if(!bus)goto failed;
  GVariantBuilder options;g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);
  GVariant *reply=g_dbus_connection_call_sync(bus,"org.freedesktop.portal.Flatpak","/org/freedesktop/portal/Flatpak",
    "org.freedesktop.portal.Flatpak","CreateUpdateMonitor",g_variant_new("(a{sv})",&options),G_VARIANT_TYPE("(o)"),G_DBUS_CALL_FLAGS_NONE,15000,NULL,&error);
  if(!reply)goto failed;
  gchar *path;g_variant_get(reply,"(o)",&path);g_variant_unref(reply);
  loop=g_main_loop_new(NULL,FALSE);
  guint subscription=g_dbus_connection_signal_subscribe(bus,"org.freedesktop.portal.Flatpak",
    "org.freedesktop.portal.Flatpak.UpdateMonitor","Progress",path,NULL,G_DBUS_SIGNAL_FLAGS_NONE,progress,NULL,NULL);
  g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);
  reply=g_dbus_connection_call_sync(bus,"org.freedesktop.portal.Flatpak",path,
    "org.freedesktop.portal.Flatpak.UpdateMonitor","Update",g_variant_new("(sa{sv})","",&options),NULL,G_DBUS_CALL_FLAGS_NONE,65000,NULL,&error);
  if(reply){g_variant_unref(reply);g_main_loop_run(loop);}
  g_dbus_connection_signal_unsubscribe(bus,subscription);
  g_free(path);g_main_loop_unref(loop);g_object_unref(bus);
  if(error){g_printerr("%s\n",error->message);g_error_free(error);}
  return result;
failed:
  if(error){g_printerr("%s\n",error->message);g_error_free(error);}
  if(bus)g_object_unref(bus);
  return 1;
}
