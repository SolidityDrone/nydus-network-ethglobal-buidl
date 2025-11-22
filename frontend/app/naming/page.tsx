'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showToast } from '@/components/Toast';
import { useAccount, useSignMessage } from 'wagmi';
import { useZkAddress } from '@/context/AccountProvider';
import {
  registerSubdomain,
  getAllSubdomains,
  checkSubdomainAvailability,
  updateSubdomain,
  type SubnameInfo,
} from '@/lib/justaname-api';
import { requestSIWEChallenge } from '@/lib/justaname-siwe';

export default function NamingPage() {
  const { address, isConnected } = useAccount();
  const zkAddress = useZkAddress();
  const { signMessageAsync } = useSignMessage();
  const [subname, setSubname] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [allSubdomains, setAllSubdomains] = useState<SubnameInfo[]>([]);
  const [isLoadingSubdomains, setIsLoadingSubdomains] = useState(false);
  
  // Update form state
  const [selectedSubname, setSelectedSubname] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  // Load all subdomains when address changes
  useEffect(() => {
    if (address) {
      loadSubdomains();
    }
  }, [address]);

  // Check availability when subname changes (only for registration)
  useEffect(() => {
    if (showUpdateForm) {
      setIsAvailable(null);
      return;
    }

    const checkAvailability = async () => {
      if (!subname.trim()) {
        setIsAvailable(null);
        return;
      }

      // Validate subdomain format
      if (!/^[a-z0-9-]+$/.test(subname)) {
        setIsAvailable(null);
        return;
      }

      setIsCheckingAvailability(true);
      const { available } = await checkSubdomainAvailability(subname);
      setIsAvailable(available);
      setIsCheckingAvailability(false);
    };

    const timeoutId = setTimeout(checkAvailability, 500);
    return () => clearTimeout(timeoutId);
  }, [subname, showUpdateForm]);

  const loadSubdomains = async () => {
    if (!address) return; // Don't load if no wallet connected
    
    setIsLoadingSubdomains(true);
    try {
      const response = await getAllSubdomains(address);
      if (response.success && response.data) {
        setAllSubdomains(response.data.names);
      }
    } catch (error) {
      console.error('Error loading subdomains:', error);
    } finally {
      setIsLoadingSubdomains(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!address) {
      showToast('Please connect your wallet first', 'error');
      return;
    }

    if (!zkAddress) {
      showToast('Please sign for ZK address first', 'error');
      return;
    }

    if (!subname.trim()) {
      showToast('Please enter a subdomain name', 'error');
      return;
    }

    // Validate subdomain format
    if (!/^[a-z0-9-]+$/.test(subname)) {
      showToast('Subdomain can only contain lowercase letters, numbers, and hyphens', 'error');
      return;
    }

    if (isAvailable === false) {
      showToast('This subdomain is already taken', 'error');
      return;
    }

    setIsLoading(true);
    try {
      console.log('=== Registration Start ===');
      console.log('zkAddress:', zkAddress);
      console.log('address:', address);
      console.log('subname:', subname);
      
      // Step 1: Request SIWE challenge from JustaName
      showToast('Requesting challenge...', 'success');
      const challenge = await requestSIWEChallenge(address);

      // Step 2: Ask user to sign the challenge
      showToast('Please sign the message in your wallet...', 'success');
      const signature = await signMessageAsync({ message: challenge });

      // Step 3: Register the subdomain with the signature
      console.log('Sending to API with description:', zkAddress);
      const response = await registerSubdomain({
        subname,
        description: zkAddress, // Use zkAddress as description
        resolutionAddress: address, // Use wallet address as resolution address
        userSignature: signature,
        userAddress: address,
        challengeMessage: challenge,
      });
      console.log('Registration response:', response);

      if (response.success) {
        showToast('Subdomain registered successfully!', 'success');
        setSubname('');
        setIsAvailable(null);
        await loadSubdomains();
      } else {
        showToast(response.error || 'Failed to register subdomain', 'error');
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to register subdomain',
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!address) {
      showToast('Please connect your wallet first', 'error');
      return;
    }

    if (!zkAddress) {
      showToast('Please sign for ZK address first', 'error');
      return;
    }

    if (!selectedSubname) {
      showToast('Please select a subdomain to update', 'error');
      return;
    }

    setIsUpdating(true);
    try {
      // Step 1: Request SIWE challenge from JustaName
      showToast('Requesting challenge...', 'success');
      const challenge = await requestSIWEChallenge(address);

      // Step 2: Ask user to sign the challenge
      showToast('Please sign the message in your wallet...', 'success');
      const signature = await signMessageAsync({ message: challenge });

      // Step 3: Update the subdomain with the signature
      const response = await updateSubdomain({
        subname: selectedSubname,
        description: zkAddress, // Use zkAddress as description
        resolutionAddress: address, // Use wallet address as resolution address
        userSignature: signature,
        userAddress: address,
        challengeMessage: challenge,
      });

      if (response.success) {
        showToast('Subdomain updated successfully!', 'success');
        setSelectedSubname(null);
        setShowUpdateForm(false);
        await loadSubdomains();
      } else {
        showToast(response.error || 'Failed to update subdomain', 'error');
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to update subdomain',
        'error'
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSelectForUpdate = (subdomain: SubnameInfo) => {
    setSelectedSubname(subdomain.name);
    setShowUpdateForm(true);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelUpdate = () => {
    setSelectedSubname(null);
    setShowUpdateForm(false);
  };

  const getEnsDomain = () => {
    return process.env.NEXT_PUBLIC_ENS_DOMAIN || 'nydusns.eth';
  };

  // Show message if wallet is not connected
  if (!isConnected || !address) {
    return (
      <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Card className="border-[#333333]">
            <CardContent className="pt-12 pb-12 text-center">
              <h2 className="text-2xl font-mono font-bold mb-4 text-white uppercase">
                WALLET NOT CONNECTED
              </h2>
              <p className="text-sm font-mono text-[#888888] mb-6">
                Please connect your wallet to access the ENS Naming Service
              </p>
              <p className="text-xs font-mono text-[#666666]">
                Click the "Connect Wallet" button in the navigation bar
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-mono font-bold mb-4 text-white uppercase tracking-wider">
            ENS Naming Service
          </h1>
          <p className="text-sm sm:text-base font-mono text-[#888888]">
            Register and manage your ENS subdomains on {getEnsDomain()}
          </p>
        </div>

        {/* Toggle Buttons */}
        <div className="flex gap-2 mb-6">
          <Button
            onClick={() => {
              setShowUpdateForm(false);
              handleCancelUpdate();
            }}
            variant={!showUpdateForm ? "default" : "outline"}
            className="flex-1 font-mono"
          >
            REGISTER NEW
          </Button>
          <Button
            onClick={() => setShowUpdateForm(true)}
            variant={showUpdateForm ? "default" : "outline"}
            className="flex-1 font-mono"
          >
            UPDATE EXISTING
          </Button>
        </div>

        {/* Registration Form */}
        {!showUpdateForm && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="font-mono">$ REGISTER SUBDOMAIN</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-mono text-[#888888] mb-2">
                    SUBDOMAIN NAME
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={subname}
                      onChange={(e) => setSubname(e.target.value.toLowerCase())}
                      placeholder="myname"
                      className="font-mono flex-1"
                      disabled={isLoading}
                    />
                    <span className="text-[#888888] font-mono">.{getEnsDomain()}</span>
                  </div>
                  {isCheckingAvailability && (
                    <p className="text-xs font-mono text-[#888888] mt-1">
                      Checking availability...
                    </p>
                  )}
                  {isAvailable === true && subname.trim() && (
                    <p className="text-xs font-mono text-green-500 mt-1">
                      ✓ Available
                    </p>
                  )}
                  {isAvailable === false && (
                    <p className="text-xs font-mono text-red-500 mt-1">
                      ✗ Already taken
                    </p>
                  )}
                  <p className="text-xs font-mono text-[#666666] mt-1">
                    Only lowercase letters, numbers, and hyphens allowed
                  </p>
                </div>

                <div className="space-y-3">
                  {address && (
                    <div className="bg-[#0a0a0a] border border-[#333333] rounded p-3">
                      <label className="block text-xs font-mono text-[#888888] mb-1">
                        RESOLUTION ADDRESS (WHERE SUBDOMAIN POINTS TO)
                      </label>
                      <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                        {address}
                      </p>
                    </div>
                  )}

                  {zkAddress && (
                    <div className="bg-[#0a0a0a] border border-[#333333] rounded p-3">
                      <label className="block text-xs font-mono text-[#888888] mb-1">
                        DESCRIPTION (ZK ADDRESS)
                      </label>
                      <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                        {zkAddress}
                      </p>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !subname.trim() || isAvailable === false || !address || !zkAddress}
                  className="w-full font-mono"
                >
                  {isLoading ? 'REGISTERING...' : !address ? 'CONNECT WALLET FIRST' : !zkAddress ? 'SIGN FOR ZK ADDRESS' : 'REGISTER SUBDOMAIN'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Update Form */}
        {showUpdateForm && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="font-mono flex items-center justify-between">
                <span>$ UPDATE SUBDOMAIN</span>
                {selectedSubname && (
                  <Button
                    onClick={handleCancelUpdate}
                    variant="outline"
                    size="sm"
                    className="font-mono"
                  >
                    CANCEL
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedSubname ? (
                <div className="text-center py-8">
                  <p className="text-sm font-mono text-[#888888] mb-4">
                    Select a subdomain from the list below to update
                  </p>
                </div>
              ) : (
                <form onSubmit={handleUpdate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-mono text-[#888888] mb-2">
                      SUBDOMAIN NAME
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={selectedSubname}
                        className="font-mono flex-1"
                        disabled
                      />
                      <span className="text-[#888888] font-mono">.{getEnsDomain()}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {address && (
                      <div className="bg-[#0a0a0a] border border-[#333333] rounded p-3">
                        <label className="block text-xs font-mono text-[#888888] mb-1">
                          RESOLUTION ADDRESS (WHERE SUBDOMAIN POINTS TO)
                        </label>
                        <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                          {address}
                        </p>
                      </div>
                    )}

                    {zkAddress && (
                      <div className="bg-[#0a0a0a] border border-[#333333] rounded p-3">
                        <label className="block text-xs font-mono text-[#888888] mb-1">
                          DESCRIPTION (ZK ADDRESS)
                        </label>
                        <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                          {zkAddress}
                        </p>
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={isUpdating || !address || !zkAddress}
                    className="w-full font-mono"
                  >
                    {isUpdating ? 'UPDATING...' : !address ? 'CONNECT WALLET FIRST' : !zkAddress ? 'SIGN FOR ZK ADDRESS' : 'UPDATE SUBDOMAIN'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {/* All Subdomains List */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono flex items-center justify-between">
              <span>$ REGISTERED SUBDOMAINS</span>
              <Button
                onClick={loadSubdomains}
                disabled={isLoadingSubdomains}
                variant="outline"
                size="sm"
                className="font-mono"
              >
                {isLoadingSubdomains ? 'LOADING...' : 'REFRESH'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSubdomains ? (
              <div className="text-center py-8">
                <p className="text-sm font-mono text-[#888888]">Loading subdomains...</p>
              </div>
            ) : allSubdomains.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm font-mono text-[#888888]">
                  No subdomains registered yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {allSubdomains.map((subdomain) => (
                  <div
                    key={subdomain.name}
                    className="border border-[#333333] rounded-lg p-4 hover:border-[#555555] transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <h3 className="font-mono font-bold text-white">
                          {subdomain.name}.{getEnsDomain()}
                        </h3>
                        
                        <div className="bg-[#0a0a0a] border border-[#222222] rounded p-2">
                          <p className="text-xs font-mono text-[#666666] mb-1">
                            RESOLUTION ADDRESS:
                          </p>
                          <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                            {subdomain.address}
                          </p>
                        </div>

                        <div className="bg-[#0a0a0a] border border-[#222222] rounded p-2">
                          <p className="text-xs font-mono text-[#666666] mb-1">
                            ZK ADDRESS (DESCRIPTION):
                          </p>
                          {subdomain.description ? (
                            <p className="text-xs font-mono text-[rgba(182,255,62,1)] break-all">
                              {subdomain.description}
                            </p>
                          ) : (
                            <p className="text-xs font-mono text-red-500">
                              Not set (subdomain registered without zkAddress)
                            </p>
                          )}
                        </div>
                      </div>
                      {showUpdateForm && (
                        <Button
                          onClick={() => handleSelectForUpdate(subdomain)}
                          variant="outline"
                          size="sm"
                          className="font-mono ml-4"
                          disabled={selectedSubname === subdomain.name}
                        >
                          {selectedSubname === subdomain.name ? 'SELECTED' : 'UPDATE'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

