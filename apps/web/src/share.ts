// The link to share for a board is the address of the page the
// board is open on, without any query or hash. Boards live in the
// app, not in the URL, so the page address is the whole link —
// there is no per-board address to build.
export function buildBoardLink(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}
