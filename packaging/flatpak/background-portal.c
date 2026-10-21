/* SPDX-License-Identifier: MIT
 * Keep one D-Bus connection alive for RequestBackground and its directed reply.
 */
#include <gio/gio.h>
#include <unistd.h>

static GMainLoop *loop;
static gchar *request_path;
static gboolean granted;

static gboolean timeout_response(gpointer unused) {
  (void)unused;
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}

static void response(GDBusConnection *connection, const gchar *sender,
                     const gchar *object_path, const gchar *interface,
                     const gchar *signal, GVariant *parameters, gpointer unused) {
  (void)connection; (void)sender; (void)interface; (void)signal; (void)unused;
  if (g_strcmp0(object_path, request_path) != 0 ||
      !g_variant_is_of_type(parameters, G_VARIANT_TYPE("(ua{sv})"))) return;
  guint32 status;
  GVariant *results;
  gboolean background = FALSE;
  g_variant_get(parameters, "(u@a{sv})", &status, &results);
  g_variant_lookup(results, "background", "b", &background);
  granted = status == 0 && background;
  g_variant_unref(results);
  g_main_loop_quit(loop);
}

int main(void) {
  GDBusConnection *connection = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
  if (connection == NULL) { g_print("denied\n"); return 0; }
  gchar *sender = g_strdup(g_dbus_connection_get_unique_name(connection) + 1);
  for (gchar *p = sender; *p; p++) if (*p == '.') *p = '_';
  gchar *token = g_strdup_printf("airdrop%ld", (long)getpid());
  request_path = g_strdup_printf("/org/freedesktop/portal/desktop/request/%s/%s", sender, token);
  loop = g_main_loop_new(NULL, FALSE);
  guint subscription = g_dbus_connection_signal_subscribe(connection,
    "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response",
    NULL, NULL, G_DBUS_SIGNAL_FLAGS_NONE, response, NULL, NULL);
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token));
  g_variant_builder_add(&options, "{sv}", "reason", g_variant_new_string("Keep sharing files after closing the window"));
  g_variant_builder_add(&options, "{sv}", "autostart", g_variant_new_boolean(FALSE));
  GVariant *reply = g_dbus_connection_call_sync(connection,
    "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
    "org.freedesktop.portal.Background", "RequestBackground",
    g_variant_new("(sa{sv})", "", &options), G_VARIANT_TYPE("(o)"),
    G_DBUS_CALL_FLAGS_NONE, 10000, NULL, NULL);
  if (reply != NULL) {
    const gchar *returned_path;
    g_variant_get(reply, "(&o)", &returned_path);
    g_free(request_path); request_path = g_strdup(returned_path);
    g_variant_unref(reply);
    guint timer = g_timeout_add_seconds(50, timeout_response, NULL);
    g_main_loop_run(loop);
    GSource *source = g_main_context_find_source_by_id(NULL, timer);
    if (source != NULL) g_source_destroy(source);
  }
  g_print("%s\n", granted ? "granted" : "denied");
  g_dbus_connection_signal_unsubscribe(connection, subscription);
  g_main_loop_unref(loop);
  g_object_unref(connection);
  g_free(sender); g_free(token); g_free(request_path);
  return 0;
}
