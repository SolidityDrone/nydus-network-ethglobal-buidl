// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

/**
 * @title Generators
 * @dev Pedersen commitment generators for Grumpkin curve
 * @notice These generators match the output of Noir's derive_generators("PEDERSEN_COMMITMENT", 0)
 */
library Generators {
    // Generator G (first generator for amount)
    uint256 public constant G_X = 0x25630136fe1c61cbfaf1c6acb59edd53cebf87d0dc341132a6a2af3c077afb4f;
    uint256 public constant G_Y = 0x0ebe7c8574896e51ac5d1140a74e3d4cbda2b338c4e2a9f1e1e94dca28a60747;
    
    // Generator H (second generator for blinding factor)
    uint256 public constant H_X = 0x25edc94b5b4b8bdb0601895d7d51a098ee051e4aed3837b23b2f7510893d613d;
    uint256 public constant H_Y = 0x18dfd2d181d3272513698220ac5fb371004335ffa6702aade8b647dbe0b3dce1;
    
    // Generator D (third generator for domain separation)
    uint256 public constant D_X = 0x02b0b4e69873f1551d49f57e25b587289ce25cf5f641722ec1d8fa44495eff81;
    uint256 public constant D_Y = 0x19ac5f9bd16c9dedfd6cc4384e2105c1a87ec67974c83b52c4a2846d093d21d2;
    
    /**
     * @dev Get generator G as a struct
     * @return x X coordinate of generator G
     * @return y Y coordinate of generator G
     */
    function getG() internal pure returns (uint256 x, uint256 y) {
        return (G_X, G_Y);
    }
    
    /**
     * @dev Get generator H as a struct
     * @return x X coordinate of generator H
     * @return y Y coordinate of generator H
     */
    function getH() internal pure returns (uint256 x, uint256 y) {
        return (H_X, H_Y);
    }
    
    /**
     * @dev Get generator D as a struct
     * @return x X coordinate of generator D
     * @return y Y coordinate of generator D
     */
    function getD() internal pure returns (uint256 x, uint256 y) {
        return (D_X, D_Y);
    }
}

