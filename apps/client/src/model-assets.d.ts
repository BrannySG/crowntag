/** Lets Vite import Nature Kit OBJ/MTL models as resolved asset URLs (see vite.config.ts assetsInclude). */
declare module '*.obj' {
  const url: string;
  export default url;
}

declare module '*.mtl' {
  const url: string;
  export default url;
}
