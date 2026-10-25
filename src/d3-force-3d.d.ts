// Minimal type declarations for the parts of d3-force-3d that this plugin uses.
declare module "d3-force-3d" {
  export interface SimNode {
    x?: number; y?: number; z?: number;
    vx?: number; vy?: number; vz?: number;
  }

  export type Force = ((alpha: number) => void) & { initialize?: () => void };

  export interface LinkForce<N> {
    id(accessor: (node: N) => string): LinkForce<N>;
    distance(value: number): LinkForce<N>;
    strength(value: number): LinkForce<N>;
  }

  export interface ManyBodyForce {
    strength(value: number): ManyBodyForce;
  }

  export type CenterForce = object;

  export interface Simulation {
    force(name: string, force: Force | LinkForce<never> | ManyBodyForce | CenterForce): Simulation;
    alpha(): number;
    alpha(value: number): Simulation;
    alphaDecay(value: number): Simulation;
    restart(): Simulation;
    stop(): Simulation;
  }

  export function forceSimulation(nodes: SimNode[], numDimensions?: number): Simulation;
  export function forceLink<N, L>(links: L[]): LinkForce<N>;
  export function forceManyBody(): ManyBodyForce;
  export function forceCenter(x?: number, y?: number, z?: number): CenterForce;
}
