    // ===== 3.1 LRU 缓存 =====
    // LRU 缓存实现，限制最大条目数防止内存膨胀
    class LRUCache {
        constructor(maxSize = 500) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }
        has(key) {
            return this.cache.has(key);
        }
        get(key) {
            if (!this.cache.has(key)) return undefined;
            // 访问时移到末尾（最近使用）
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        set(key, value) {
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= this.maxSize) {
                // 删除最旧的条目（Map 迭代器第一个）
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
            this.cache.set(key, value);
        }
        get size() {
            return this.cache.size;
        }
    }
