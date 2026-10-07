// The release stamp covers the complete module graph, including lazy modules.
// Keep entry points, preloads and imports on the same graph after an upgrade.
export function versionModuleUrls(source,version){
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"\s]+\.js)\2/g,(_,prefix,quote,url)=>prefix+quote+url+'?v='+version+quote);
}
export function versionHtmlUrls(source,version){
  return source.replace(/(\b(?:src|href)=)(['"])([^'"?#:]+\.(?:js|css))\2/g,(_,prefix,quote,url)=>url.startsWith('/')?prefix+quote+url+quote:prefix+quote+url+'?v='+version+quote);
}
