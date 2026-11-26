function normalizeMeshMessage(row) {
  var me = ((state.profile && state.profile.displayName) || "Scott").trim();
  var time = (row && row.created_at) ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now";
  return { id: (row && row.id) || ("mesh-" + Date.now()), sender: sender, handle: String((row && row.handle) || "").trim(), text: String((row && row.text) || ""), time: time, outgoing: sender.toLowerCase() === me.toLowerCase() };
