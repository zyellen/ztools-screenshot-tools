export interface ExpectedGeometry { dx:number; dy:number; dw:number; dh:number }
export interface ActualGeometry { screenX:number; screenY:number; innerWidth:number; innerHeight:number }
export function overlayGeometry(expected: ExpectedGeometry, actual: ActualGeometry) {
  const mismatch = Math.abs(expected.dx-actual.screenX)>1 || Math.abs(expected.dy-actual.screenY)>1 ||
    Math.abs(expected.dw-actual.innerWidth)>1 || Math.abs(expected.dh-actual.innerHeight)>1
  return { mismatch, left:mismatch ? expected.dx-actual.screenX : 0, top:mismatch ? expected.dy-actual.screenY : 0 }
}
