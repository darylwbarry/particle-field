import sys, numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
def draw(ax, path, color, offset=(0,0,0), flipz=None):
    m = trimesh.load(path)
    v = m.vertices.copy()
    if flipz is not None: v[:,1] = -v[:,1]; v[:,2] = flipz - v[:,2]
    v += np.array(offset)
    tri = v[m.faces]
    n = np.cross(tri[:,1]-tri[:,0], tri[:,2]-tri[:,0]); n /= (np.linalg.norm(n,axis=1)[:,None]+1e-12)
    light = np.array([0.4,-0.6,0.8]); light/=np.linalg.norm(light)
    s = 0.35 + 0.65*np.clip(n@light, 0, 1)
    c = np.array(matplotlib.colors.to_rgb(color))
    pc = Poly3DCollection(tri, facecolors=np.clip(c[None,:]*s[:,None],0,1), linewidths=0)
    ax.add_collection3d(pc)
    return v
def setup(ax, pts, elev=28, azim=-60):
    mn, mx = pts.min(0), pts.max(0); c=(mn+mx)/2; r=(mx-mn).max()/2
    ax.set_xlim(c[0]-r,c[0]+r); ax.set_ylim(c[1]-r,c[1]+r); ax.set_zlim(c[2]-r,c[2]+r)
    ax.view_init(elev, azim); ax.set_axis_off(); ax.set_box_aspect((1,1,1))
