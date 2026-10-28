/* SPDX-License-Identifier: MIT
 * Open a directory through the host's default file manager using an FD.
 * OpenFile explicitly supports directories; OpenDirectory would open its parent.
 */
#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <stdio.h>

static GMainLoop *loop;
static gchar *request_path;
static int result = 1;

static int retrieve_files(const char *key) {
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) goto failed;
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  GVariant *reply = g_dbus_connection_call_sync(bus,
    "org.freedesktop.portal.Documents", "/org/freedesktop/portal/documents",
    "org.freedesktop.portal.FileTransfer", "RetrieveFiles",
    g_variant_new("(sa{sv})", key, &options), G_VARIANT_TYPE("(as)"),
    G_DBUS_CALL_FLAGS_NONE, 10000, NULL, &error);
  if (!reply) goto failed;
  gchar **files;
  g_variant_get(reply, "(^as)", &files);
  for (gchar **file = files; *file; file++) {
    gchar *uri = g_filename_to_uri(*file, NULL, &error);
    if (!uri) { g_strfreev(files); g_variant_unref(reply); goto failed; }
    g_print("%s\n", uri); g_free(uri);
  }
  g_strfreev(files); g_variant_unref(reply); g_object_unref(bus);
  return 0;
failed:
  g_printerr("Clipboard file transfer expired or is unavailable. Copy the files again or use Choose files.\n");
  g_clear_error(&error);
  if (bus) g_object_unref(bus);
  return 1;
}

/* Export only the explicitly dragged regular files. Keep the connection alive
 * until Electron completes the drag, including for unsandboxed URI consumers.
 * Transient document grants do not grant access to home or neighbouring files.
 */
static int export_files(int argc, char **argv) {
  (void)argv;
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) goto failed;
  GVariant *mount_reply = g_dbus_connection_call_sync(bus,
    "org.freedesktop.portal.Documents", "/org/freedesktop/portal/documents",
    "org.freedesktop.portal.Documents", "GetMountPoint", NULL,
    G_VARIANT_TYPE("(ay)"), G_DBUS_CALL_FLAGS_NONE, 10000, NULL, &error);
  if (!mount_reply) goto failed;
  gchar *mount;
  g_variant_get(mount_reply, "(^ay)", &mount);
  g_variant_unref(mount_reply);
  for (int i = 2; i < argc; i++) {
    /* Validated file descriptors are inherited from Electron, beginning at 3.
     * Never reopen a path after validation: a parent directory can be renamed.
     */
    int fd = dup(i + 1);
    struct stat st;
    if (fd < 0 || fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
      if (fd >= 0) close(fd);
      g_free(mount); goto failed;
    }
    gchar *fd_path = g_strdup_printf("/proc/self/fd/%d", fd);
    gchar *actual = g_file_read_link(fd_path, &error);
    g_free(fd_path);
    if (!actual) { close(fd); g_free(mount); goto failed; }
    gchar *name = g_path_get_basename(actual);
    g_free(actual);
    GUnixFDList *fds = g_unix_fd_list_new();
    int index = g_unix_fd_list_append(fds, fd, &error);
    close(fd);
    GVariant *reply = NULL;
    if (index >= 0) reply = g_dbus_connection_call_with_unix_fd_list_sync(bus,
      "org.freedesktop.portal.Documents", "/org/freedesktop/portal/documents",
      "org.freedesktop.portal.Documents", "Add", g_variant_new("(hbb)", index, TRUE, FALSE),
      G_VARIANT_TYPE("(s)"), G_DBUS_CALL_FLAGS_NONE, 10000, fds, NULL, NULL, &error);
    g_object_unref(fds);
    if (!reply) { g_free(name); g_free(mount); goto failed; }
    const gchar *id;
    g_variant_get(reply, "(&s)", &id);
    gchar *exported = g_build_filename(mount, id, name, NULL);
    gchar *uri = g_filename_to_uri(exported, NULL, &error);
    if (uri) g_print("%s\n", uri);
    g_free(name); g_free(exported); g_variant_unref(reply);
    if (!uri) { g_free(mount); goto failed; }
    g_free(uri);
  }
  g_free(mount);
  g_print("ready\n"); fflush(stdout);
  (void)getchar();
  g_object_unref(bus);
  return 0;
failed:
  g_printerr("Could not export dragged files through the document portal%s%s\n", error ? ": " : "", error ? error->message : "");
  g_clear_error(&error);
  if (bus) g_object_unref(bus);
  return 1;
}

static gboolean timeout_response(gpointer unused) {
  (void)unused;
  g_printerr("The file manager portal did not respond. Check your desktop portal configuration.\n");
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
  GVariant *details;
  g_variant_get(parameters, "(u@a{sv})", &status, &details);
  result = status == 0 ? 0 : 1;
  if (result) g_printerr("The file manager request was cancelled or rejected.\n");
  g_variant_unref(details);
  g_main_loop_quit(loop);
}

int main(int argc, char **argv) {
  if (argc == 3 && g_strcmp0(argv[1], "--retrieve") == 0) return retrieve_files(argv[2]);
  if (argc >= 3 && argc <= 102 && g_strcmp0(argv[1], "--export") == 0) return export_files(argc, argv);
  if (argc != 2) return 2;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) { g_printerr("Cannot open the shared directory.\n"); return 1; }
  GError *error = NULL;
  GDBusConnection *connection = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!connection) { g_printerr("%s\n", error->message); g_error_free(error); close(fd); return 1; }
  gchar *sender = g_strdup(g_dbus_connection_get_unique_name(connection) + 1);
  for (gchar *p = sender; *p; p++) if (*p == '.') *p = '_';
  gchar *token = g_strdup_printf("airdropfolder%ld", (long)getpid());
  request_path = g_strdup_printf("/org/freedesktop/portal/desktop/request/%s/%s", sender, token);
  loop = g_main_loop_new(NULL, FALSE);
  guint subscription = g_dbus_connection_signal_subscribe(connection,
    "org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response",
    NULL, NULL, G_DBUS_SIGNAL_FLAGS_NONE, response, NULL, NULL);
  GUnixFDList *fds = g_unix_fd_list_new();
  int index = g_unix_fd_list_append(fds, fd, &error);
  close(fd);
  GVariantBuilder options;
  g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
  g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token));
  GVariant *reply = NULL;
  if (index >= 0) reply = g_dbus_connection_call_with_unix_fd_list_sync(connection,
    "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
    "org.freedesktop.portal.OpenURI", "OpenFile",
    g_variant_new("(sha{sv})", "", index, &options), G_VARIANT_TYPE("(o)"),
    G_DBUS_CALL_FLAGS_NONE, 10000, fds, NULL, NULL, &error);
  if (reply) {
    const gchar *returned;
    g_variant_get(reply, "(&o)", &returned);
    g_free(request_path); request_path = g_strdup(returned);
    g_variant_unref(reply);
    guint timer = g_timeout_add_seconds(50, timeout_response, NULL);
    g_main_loop_run(loop);
    GSource *source = g_main_context_find_source_by_id(NULL, timer);
    if (source) g_source_destroy(source);
  }
  if (error) { g_printerr("%s\n", error->message); g_error_free(error); }
  g_dbus_connection_signal_unsubscribe(connection, subscription);
  g_main_loop_unref(loop); g_object_unref(fds); g_object_unref(connection);
  g_free(sender); g_free(token); g_free(request_path);
  return result;
}
