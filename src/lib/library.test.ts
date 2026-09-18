import { describe, expect, it } from 'vitest';
import { prunable } from './library';

const image = (id: string, usedAt: number) => ({ id, usedAt });

describe('prunable', () => {
  it('keeps everything while under the limit', () => {
    const images = [image('a', 3), image('b', 2), image('c', 1)];
    expect(prunable(images, [], 10)).toEqual([]);
  });

  it('drops the least recently used once over', () => {
    const images = [image('new', 5), image('mid', 3), image('old', 1)];
    expect(prunable(images, [], 2)).toEqual(['old']);
  });

  it('never drops an image that is in a collection', () => {
    // The whole point: ageing out a recent is fine, deleting something the
    // user deliberately filed is not.
    const images = [image('new', 9), image('filed', 1), image('loose', 2)];
    const collections = [{ imageIds: ['filed'] }];

    expect(prunable(images, collections, 1)).toEqual(['loose']);
  });

  it('does not count collected images against the limit', () => {
    const images = [image('a', 4), image('b', 3), image('c', 2), image('d', 1)];
    const collections = [{ imageIds: ['a', 'b', 'c'] }];

    // Only 'd' is loose, so a limit of 2 still has room for it.
    expect(prunable(images, collections, 2)).toEqual([]);
  });

  it('handles an image filed in more than one collection', () => {
    const images = [image('a', 2), image('b', 1)];
    const collections = [{ imageIds: ['a'] }, { imageIds: ['a', 'b'] }];
    expect(prunable(images, collections, 0)).toEqual([]);
  });

  it('drops everything loose when the limit is zero', () => {
    const images = [image('a', 2), image('b', 1)];
    expect(prunable(images, [], 0).sort()).toEqual(['a', 'b']);
  });

  it('copes with an empty library', () => {
    expect(prunable([], [], 10)).toEqual([]);
  });

  it('is stable regardless of the order it is given images in', () => {
    const images = [image('old', 1), image('new', 3), image('mid', 2)];
    const shuffled = [image('mid', 2), image('old', 1), image('new', 3)];
    expect(prunable(images, [], 1)).toEqual(prunable(shuffled, [], 1));
  });
});
