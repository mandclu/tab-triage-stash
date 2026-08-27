// memoryProvider.js
// Feature-detects the Dev-channel `chrome.processes` API. When present (and the
// optional "processes" permission is granted), returns real private-memory
// figures per process; otherwise returns nulls and the report shows estimates.

export function getMemoryProvider() {
  if (typeof chrome.processes === "object" && chrome.processes.getProcessInfo) {
    return new RealMemoryProvider(); // Dev channel, permission granted
  }
  return new HeuristicProvider();    // stable channel — estimates only
}

class RealMemoryProvider {
  mode = "measured";
  async forTabs(tabs) {
    const pids = await Promise.all(
      tabs.map(
        (t) =>
          new Promise((resolve) =>
            chrome.processes.getProcessIdForTab(t.id, resolve)
          )
      )
    );
    const info = await new Promise((resolve) =>
      chrome.processes.getProcessInfo(pids, /* includeMemory */ true, resolve)
    );
    // Count how many tabs share each process, so the UI can flag co-tenancy.
    const tabsPerPid = pids.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {});
    return tabs.map((t, i) => ({
      tabId: t.id,
      pid: pids[i],
      bytes: info[pids[i]]?.privateMemory ?? null,
      sharedWith: (tabsPerPid[pids[i]] || 1) - 1,
    }));
  }
}

class HeuristicProvider {
  mode = "estimated";
  async forTabs(tabs) {
    return tabs.map((t) => ({ tabId: t.id, bytes: null, sharedWith: 0 }));
  }
}

// Call from a user gesture (a button click) in an extension PAGE — not the
// service worker — so the permission prompt has a valid gesture context.
export async function requestMeasuredMemory() {
  try {
    const granted = await chrome.permissions.request({ permissions: ["processes"] });
    return granted && typeof chrome.processes === "object";
  } catch {
    // Stable/Beta Chrome may reject an unrecognized optional permission — that's
    // fine, it just means measured mode isn't available here.
    return false;
  }
}
