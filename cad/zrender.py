import numpy as np, trimesh
from PIL import Image
def render(items, W=1400, H=1000, elev=30, azim=-55, path="out.png", bg=(255,255,255)):
    """items: list of (mesh, rgb). Orthographic z-buffer with Lambert shading + outline."""
    e, a = np.radians(elev), np.radians(azim)
    R1 = np.array([[np.cos(a),-np.sin(a),0],[np.sin(a),np.cos(a),0],[0,0,1]])
    R2 = np.array([[1,0,0],[0,np.cos(e),-np.sin(e)],[0,np.sin(e),np.cos(e)]])
    # view: rotate about Z by azim, then tilt so we look down
    R = np.array([[1,0,0],[0,0,1],[0,-1,0]]) @ R2.T @ np.array([[1,0,0],[0,0,-1],[0,1,0]]) @ R1
    allv = np.vstack([m.vertices @ R.T for m,_ in items]); mn, mx = allv.min(0), allv.max(0)
    s = 0.9*min(W/(mx[0]-mn[0]), H/(mx[1]-mn[1])); off = np.array([W/2,H/2]) - s*(mn[:2]+mx[:2])/2
    zb = np.full((H,W), -1e9); img = np.zeros((H,W,3)); img[:] = bg; ids = np.zeros((H,W),int)-1
    L = np.array([-0.4,0.5,0.75]); L/=np.linalg.norm(L); fid=0
    for m, col in items:
        v = m.vertices @ R.T; p = v[:,:2]*s+off; p[:,1] = H-p[:,1]; z = v[:,2]
        n = m.face_normals @ R.T
        sh = 0.45+0.55*np.clip(n@L,0,1)
        for f,(i,j,k) in enumerate(m.faces):
            if n[f,2] <= 0: continue
            P = p[[i,j,k]]; x0,y0 = np.floor(P.min(0)).astype(int); x1,y1 = np.ceil(P.max(0)).astype(int)
            x0=max(x0,0); y0=max(y0,0); x1=min(x1,W-1); y1=min(y1,H-1)
            if x1<x0 or y1<y0: continue
            xs, ys = np.meshgrid(np.arange(x0,x1+1)+0.5, np.arange(y0,y1+1)+0.5)
            d = (P[1,1]-P[2,1])*(P[0,0]-P[2,0])+(P[2,0]-P[1,0])*(P[0,1]-P[2,1])
            if abs(d)<1e-9: continue
            w0 = ((P[1,1]-P[2,1])*(xs-P[2,0])+(P[2,0]-P[1,0])*(ys-P[2,1]))/d
            w1 = ((P[2,1]-P[0,1])*(xs-P[2,0])+(P[0,0]-P[2,0])*(ys-P[2,1]))/d
            w2 = 1-w0-w1; inside = (w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)
            zz = w0*z[i]+w1*z[j]+w2*z[k]
            sub = zb[y0:y1+1,x0:x1+1]; upd = inside & (zz>sub)
            sub[upd] = zz[upd]; img[y0:y1+1,x0:x1+1][upd] = np.array(col)*sh[f]; ids[y0:y1+1,x0:x1+1][upd]=fid
        fid+=1
    # silhouette edges between parts / background
    edge = np.zeros((H,W),bool); edge[:,1:] |= ids[:,1:]!=ids[:,:-1]; edge[1:,:] |= ids[1:,:]!=ids[:-1,:]
    dz = np.zeros((H,W)); dz[:,1:] = np.abs(np.diff(zb,axis=1)); edge |= (dz>3)&(zb>-1e8)
    img[edge] = img[edge]*0.35
    Image.fromarray(np.clip(img,0,255).astype(np.uint8)).save(path)
